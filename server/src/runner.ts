import crypto from "node:crypto";
import { jsonrepair } from "jsonrepair";
import { store, db } from "./db.ts";
import {
  streamHermesEvents,
  startHermesRun,
  hermesChat,
  hermesChatStream,
} from "./hermes.ts";
import { getModelForPhase, getMaxParallelResearch } from "./settings.ts";
import {
  extractKnowledge,
  extractPhaseKnowledge,
} from "./knowledge.ts";
import { searchPriorKnowledge } from "./retrieval.ts";
import {
  planPrompt,
  researchPrompt,
  draftPrompt,
  outlinePrompt,
  editorPrompt,
  critiquePrompt,
  critiqueInstructionPrompt,
  revisePrompt,
  reviseInstructionPrompt,
  directReportPrompt,
  followupContextPrompt,
  researchAdequacyPrompt,
  reportQualityPrompt,
  planReviewPrompt,
  thesisPrompt,
  parseThesis,
  parsePlan,
  isMinorRefinement,
} from "./prompt.ts";
import type {
  Phase,
  PhaseKind,
  TaskMode,
  TaskEvent,
  TokenUsage,
  ParsedThesis,
} from "../../shared/types.ts";

function getMaxResearch(): number {
  return getMaxParallelResearch();
}

// ---------------------------------------------------------------------------
// Broadcast channel
// ---------------------------------------------------------------------------
export interface PipelineEvent {
  event: string;
  data: Record<string, unknown>;
}

type Subscriber = (event: PipelineEvent) => void;
const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(taskId: string, fn: Subscriber): () => void {
  let set = subscribers.get(taskId);
  if (!set) {
    set = new Set();
    subscribers.set(taskId, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) subscribers.delete(taskId);
  };
}

function broadcast(taskId: string, event: PipelineEvent) {
  const set = subscribers.get(taskId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Run one hermes invocation tied to an already-created phase row
// ---------------------------------------------------------------------------
const phaseControllers = new Map<number, AbortController>();

// In-memory streaming buffer: accumulates message.delta per running phase
// so clients that subscribe mid-stream can see the prior content.
// Cleared when phase completes/fails.
const phaseStreamBuffers = new Map<number, string>();

/** Get the partial streaming output for a phase that's currently running. */
export function getStreamBuffer(phaseId: number): string | undefined {
  return phaseStreamBuffers.get(phaseId);
}

function appendStreamBuffer(phaseId: number, delta: string): void {
  phaseStreamBuffers.set(phaseId, (phaseStreamBuffers.get(phaseId) || "") + delta);
}

function clearStreamBuffer(phaseId: number): void {
  phaseStreamBuffers.delete(phaseId);
}

async function runPhase(opts: {
  taskId: string;
  phaseId: number;
  kind: string;
  prompt: string;
  conversationHistory?: { role: string; content: string }[];
}): Promise<{ output: string; usage?: TokenUsage }> {
  const { taskId, phaseId, kind, prompt } = opts;

  const model = getModelForPhase(kind);
  const runId = await startHermesRun(prompt, model, opts.conversationHistory);
  store.markPhaseRunning(phaseId, runId);

  broadcast(taskId, {
    event: "phase.started",
    data: { phaseId, runId, kind },
  });

  const controller = new AbortController();
  phaseControllers.set(phaseId, controller);

  let finalOutput = "";
  let finalUsage: TokenUsage | undefined;
  let failedError: string | null = null;

  try {
    for await (const event of streamHermesEvents(runId, controller.signal)) {
      const isDelta = event.event === "message.delta";
      if (!isDelta) {
        store.appendEvent(runId, event);
      } else if (event.delta) {
        appendStreamBuffer(phaseId, event.delta);
      }
      broadcast(taskId, {
        event: event.event,
        data: { ...event, phaseId, runId, kind },
      });

      if (event.event === "run.completed") {
        finalOutput = event.output ?? "";
        finalUsage = event.usage;
      } else if (event.event === "run.failed") {
        failedError =
          (event as TaskEvent & { error?: string }).error ?? "Run failed";
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      failedError = e instanceof Error ? e.message : String(e);
    } else {
      failedError = "Aborted";
    }
  } finally {
    phaseControllers.delete(phaseId);
    clearStreamBuffer(phaseId);
  }

  const completedAt = Date.now();

  if (failedError) {
    store.completePhase({
      phaseId,
      status: "failed",
      output: finalOutput,
      completedAt,
      error: failedError,
    });
    broadcast(taskId, {
      event: "phase.failed",
      data: { phaseId, error: failedError },
    });
    throw new Error(failedError);
  }

  store.completePhase({
    phaseId,
    status: "completed",
    output: finalOutput,
    completedAt,
    usage: finalUsage,
  });
  broadcast(taskId, {
    event: "phase.completed",
    data: { phaseId, usage: finalUsage },
  });

  return { output: finalOutput, usage: finalUsage };
}

/**
 * Lightweight phase: uses streaming chat completions (no tools).
 * Broadcasts message.delta events so the frontend can show real-time progress.
 * Ideal for plan, critique, and other text-only phases.
 */
async function runPhaseLite(opts: {
  taskId: string;
  phaseId: number;
  kind: string;
  prompt: string;
  messages?: { role: string; content: string }[];
  sessionId?: string;
}): Promise<{ output: string; usage?: TokenUsage; sessionId: string }> {
  const { taskId, phaseId, kind } = opts;

  const syntheticRunId = `lite_${phaseId}_${Date.now()}`;
  store.markPhaseRunning(phaseId, syntheticRunId);

  broadcast(taskId, {
    event: "phase.started",
    data: { phaseId, runId: syntheticRunId, kind },
  });

  try {
    const model = getModelForPhase(opts.kind);
    const stream = await hermesChatStream({
      message: opts.prompt,
      messages: opts.messages,
      sessionId: opts.sessionId,
      model,
    });

    // Consume the event stream, broadcasting + buffering deltas for real-time display
    for await (const event of stream.events) {
      if (event.event === "message.delta" && event.delta) {
        appendStreamBuffer(phaseId, event.delta);
        broadcast(taskId, {
          event: "message.delta",
          data: { phaseId, delta: event.delta, kind },
        });
      }
    }

    const completedAt = Date.now();
    const output = stream.content;
    const usage = stream.usage;

    clearStreamBuffer(phaseId);
    store.completePhase({
      phaseId,
      status: "completed",
      output,
      completedAt,
      usage,
    });
    broadcast(taskId, {
      event: "phase.completed",
      data: { phaseId, usage },
    });

    return { output, usage, sessionId: stream.sessionId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    clearStreamBuffer(phaseId);
    store.completePhase({
      phaseId,
      status: "failed",
      output: "",
      completedAt: Date.now(),
      error: msg,
    });
    broadcast(taskId, {
      event: "phase.failed",
      data: { phaseId, error: msg },
    });
    throw new Error(msg);
  }
}

export function cancelPhase(phaseId: number) {
  phaseControllers.get(phaseId)?.abort();
}

function sumUsage(usages: (TokenUsage | undefined)[]): TokenUsage {
  const sum: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  for (const u of usages) {
    if (!u) continue;
    sum.input_tokens = (sum.input_tokens ?? 0) + (u.input_tokens ?? 0);
    sum.output_tokens = (sum.output_tokens ?? 0) + (u.output_tokens ?? 0);
    sum.total_tokens = (sum.total_tokens ?? 0) + (u.total_tokens ?? 0);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Replay a cached phase (for retry)
// ---------------------------------------------------------------------------
function replayPhase(
  turnId: number,
  taskId: string,
  opts: { seq: number; branch: number; kind: PhaseKind; label: string; output: string; usage?: TokenUsage }
): void {
  const phase = store.addPhase({
    turnId,
    seq: opts.seq,
    branch: opts.branch,
    kind: opts.kind,
    label: opts.label,
    createdAt: Date.now(),
  });
  store.completePhase({
    phaseId: phase.id,
    status: "completed",
    output: opts.output,
    completedAt: Date.now(),
    usage: opts.usage,
  });
  broadcast(taskId, { event: "phase.started", data: { phaseId: phase.id, kind: opts.kind } });
  broadcast(taskId, { event: "phase.completed", data: { phaseId: phase.id, usage: opts.usage } });
}

// ---------------------------------------------------------------------------
// Pipeline orchestrator with mode selection
// ---------------------------------------------------------------------------
export interface PipelineCache {
  planOutput?: string;
  planUsage?: TokenUsage;
  planReviewOutput?: string;
  planReviewUsage?: TokenUsage;
  planReviewPassed?: boolean;
  planRevisedOutput?: string;
  planRevisedUsage?: TokenUsage;
  thesisOutput?: string;
  thesisUsage?: TokenUsage;
  thesisParsed?: ParsedThesis;
  researchByBranch?: Map<number, { output: string; usage?: TokenUsage; label: string }>;
  outlineOutput?: string;
  outlineUsage?: TokenUsage;
  draftOutput?: string;
  draftUsage?: TokenUsage;
  critiqueOutput?: string;
  critiqueUsage?: TokenUsage;
}

interface PipelineOpts {
  taskId: string;
  turnId: number;
  goal: string;
  context: string;
  toolsets: string[];
  mode: TaskMode;
  language?: string;
  priorReport?: string;
  followupMessage?: string;
  cache?: PipelineCache;
}

export async function runPipeline(opts: PipelineOpts): Promise<void> {
  const isFollowup = Boolean(opts.priorReport && opts.followupMessage);

  // Followup fast path: minor refinements skip plan+research
  const useMinorPath =
    isFollowup &&
    opts.mode !== "quick" &&
    isMinorRefinement(opts.followupMessage!);

  const effectiveMode = useMinorPath ? "minor-followup" : opts.mode;

  broadcast(opts.taskId, {
    event: "pipeline.started",
    data: { turnId: opts.turnId, mode: effectiveMode, isFollowup },
  });

  const usages: (TokenUsage | undefined)[] = [];

  try {
    let finalReport = "";
    if (opts.mode === "quick") {
      finalReport = await runQuickMode(opts, usages);
    } else if (useMinorPath) {
      finalReport = await runMinorFollowup(opts, usages);
    } else if (opts.mode === "standard") {
      finalReport = await runStandardMode(opts, usages);
    } else {
      finalReport = await runDeepMode(opts, usages);
    }

    const totalUsage = sumUsage(usages);
    store.completeTurn({
      turnId: opts.turnId,
      status: "completed",
      report: finalReport,
      completedAt: Date.now(),
      usage: totalUsage,
    });
    broadcast(opts.taskId, {
      event: "pipeline.completed",
      data: { turnId: opts.turnId, usage: totalUsage },
    });

    // Post-completion: extract knowledge + trigger chains (non-blocking)
    extractKnowledge(opts.taskId).catch(() => {});
    triggerChains(opts.taskId).catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.completeTurn({
      turnId: opts.turnId,
      status: "failed",
      report: "",
      completedAt: Date.now(),
      usage: sumUsage(usages),
      error: msg,
    });
    broadcast(opts.taskId, {
      event: "pipeline.failed",
      data: { turnId: opts.turnId, error: msg },
    });
  }
}

// ── Quick: single-call direct report ────────────────────────────────────────
async function runQuickMode(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const phase = store.addPhase({
    turnId: opts.turnId,
    seq: 0,
    branch: 0,
    kind: "write",
    label: "Write report",
    createdAt: Date.now(),
  });

  const result = await runPhase({
    taskId: opts.taskId,
    phaseId: phase.id,
    kind: "write",
    prompt: directReportPrompt({
      goal: opts.goal,
      context: opts.context,
      toolsets: opts.toolsets,
      language: opts.language,
      priorReport: opts.priorReport,
      followupMessage: opts.followupMessage,
    }),
  });
  usages.push(result.usage);
  return result.output;
}

// ── Minor followup: critique + revise only (skip plan/research) ─────────────
async function runMinorFollowup(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const critiquePhase = store.addPhase({
    turnId: opts.turnId,
    seq: 0,
    branch: 0,
    kind: "critique",
    label: "Review changes needed",
    createdAt: Date.now(),
  });

  const critiqueResult = await runPhaseLite({
    taskId: opts.taskId,
    phaseId: critiquePhase.id,
    kind: "critique",
    prompt: critiquePrompt({ goal: `${opts.goal}\n\nRefinement: ${opts.followupMessage}`, draft: opts.priorReport! }),
  });
  usages.push(critiqueResult.usage);

  const revisePhase = store.addPhase({
    turnId: opts.turnId,
    seq: 1,
    branch: 0,
    kind: "revise",
    label: "Apply changes",
    createdAt: Date.now(),
  });

  const reviseResult = await runPhase({
    taskId: opts.taskId,
    phaseId: revisePhase.id,
    kind: "revise",
    prompt: revisePrompt({
      goal: opts.goal,
      context: opts.context,
      draft: opts.priorReport!,
      critique: critiqueResult.output,
      toolsets: opts.toolsets,
      language: opts.language,
    }),
  });
  usages.push(reviseResult.usage);
  return reviseResult.output;
}

// ── Standard: plan → research → thesis → outline → draft → critique → revise ──
async function runStandardMode(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const { plan, researchResults } = await runPlanAndResearch(opts, usages);
  const { cache } = opts;
  const findings = researchResults.map((r) => ({ questionId: r.question.id, title: r.question.title, output: r.output }));

  // ── A2. Thesis (skip if cached) ──
  let thesis: ParsedThesis | null;
  if (cache?.thesisOutput !== undefined) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 2, branch: 0, kind: "critique", label: "Thesis (cached)",
      output: cache.thesisOutput, usage: cache.thesisUsage,
    });
    usages.push(cache.thesisUsage);
    thesis = cache.thesisParsed ?? null;
  } else {
    const thesisResult = await runThesis(opts, 2, plan.sections, findings);
    usages.push(thesisResult.usage);
    thesis = thesisResult.parsed;
  }

  const thesisAvailable = cache?.thesisOutput !== undefined;

  // ── Outline (seq=3) ──
  let outlineText: string;
  if (cache?.outlineOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 3, branch: 0, kind: "critique", label: "Outline (cached)",
      output: cache.outlineOutput, usage: cache.outlineUsage,
    });
    usages.push(cache.outlineUsage);
    outlineText = cache.outlineOutput;
  } else {
    const outlinePhase = store.addPhase({ turnId: opts.turnId, seq: 3, branch: 0, kind: "critique", label: "Outline", createdAt: Date.now() });
    const outlineResult = await runPhaseLite({
      taskId: opts.taskId, phaseId: outlinePhase.id, kind: "critique",
      prompt: outlinePrompt({ goal: opts.goal, plan, findings, thesis, language: opts.language }),
    });
    usages.push(outlineResult.usage);
    outlineText = outlineResult.output;
  }

  // ── Draft (seq=4) ──
  const draftPromptText = draftPrompt({
    goal: opts.goal, context: opts.context, plan,
    findings, outline: outlineText, thesis, language: opts.language,
  });

  let draftOutput: string;
  if (cache?.draftOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 4, branch: 0, kind: "draft", label: "Draft report (cached)",
      output: cache.draftOutput, usage: cache.draftUsage,
    });
    usages.push(cache.draftUsage);
    draftOutput = cache.draftOutput;
  } else {
    const draftPhase = store.addPhase({ turnId: opts.turnId, seq: 4, branch: 0, kind: "draft", label: "Draft report", createdAt: Date.now() });
    const draftResult = await runPhase({
      taskId: opts.taskId, phaseId: draftPhase.id, kind: "draft",
      prompt: draftPromptText,
    });
    usages.push(draftResult.usage);
    draftOutput = draftResult.output;
  }

  // ── Critique (seq=5) ──
  let critiqueOutput: string;
  if (cache?.critiqueOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 5, branch: 0, kind: "critique", label: "Self-critique (cached)",
      output: cache.critiqueOutput, usage: cache.critiqueUsage,
    });
    usages.push(cache.critiqueUsage);
    critiqueOutput = cache.critiqueOutput;
  } else {
    const critiquePhase = store.addPhase({ turnId: opts.turnId, seq: 5, branch: 0, kind: "critique", label: "Self-critique", createdAt: Date.now() });
    const critiqueResult = await runPhaseLite({
      taskId: opts.taskId, phaseId: critiquePhase.id, kind: "critique",
      prompt: critiqueInstructionPrompt({ goal: opts.goal, thesis, outline: outlineText }),
      messages: [
        { role: "user", content: draftPromptText },
        { role: "assistant", content: draftOutput },
        { role: "user", content: critiqueInstructionPrompt({ goal: opts.goal, thesis, outline: outlineText }) },
      ],
    });
    usages.push(critiqueResult.usage);
    critiqueOutput = critiqueResult.output;
  }

  // ── Revise (seq=6, single pass — no quality loop in standard mode) ──
  const revisePhase = store.addPhase({ turnId: opts.turnId, seq: 6, branch: 0, kind: "revise", label: "Final revision", createdAt: Date.now() });
  const reviseResult = await runPhase({
    taskId: opts.taskId, phaseId: revisePhase.id, kind: "revise",
    prompt: reviseInstructionPrompt({
      goal: opts.goal, toolsets: opts.toolsets, language: opts.language,
      thesis, outline: outlineText,
    }),
    conversationHistory: [
      { role: "user", content: "Write a draft report." },
      { role: "assistant", content: draftOutput },
      { role: "user", content: "Critique this report." },
      { role: "assistant", content: critiqueOutput },
    ],
  });
  usages.push(reviseResult.usage);
  return reviseResult.output;
}

// ── Deep: plan → research → thesis → outline → draft → critique → revise → editor ─
async function runDeepMode(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const { plan, researchResults } = await runPlanAndResearch(opts, usages);
  const { cache } = opts;
  const findings = researchResults.map((r) => ({ questionId: r.question.id, title: r.question.title, output: r.output }));

  // ── A2. Thesis (skip if cached) ──
  let thesis: ParsedThesis | null;
  if (cache?.thesisOutput !== undefined) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 2, branch: 0, kind: "critique", label: "Thesis (cached)",
      output: cache.thesisOutput, usage: cache.thesisUsage,
    });
    usages.push(cache.thesisUsage);
    thesis = cache.thesisParsed ?? null;
  } else {
    const thesisResult = await runThesis(opts, 2, plan.sections, findings);
    usages.push(thesisResult.usage);
    thesis = thesisResult.parsed;
  }

  const thesisAvailable = cache?.thesisOutput !== undefined;

  // ── Outline (seq=3 now) ──
  let outlineText: string;
  if (cache?.outlineOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 3, branch: 0, kind: "critique", label: "Outline (cached)",
      output: cache.outlineOutput, usage: cache.outlineUsage,
    });
    usages.push(cache.outlineUsage);
    outlineText = cache.outlineOutput;
  } else {
    const outlinePhase = store.addPhase({ turnId: opts.turnId, seq: 3, branch: 0, kind: "critique", label: "Outline", createdAt: Date.now() });
    const outlineResult = await runPhaseLite({
      taskId: opts.taskId, phaseId: outlinePhase.id, kind: "critique",
      prompt: outlinePrompt({ goal: opts.goal, plan, findings, thesis, language: opts.language }),
    });
    usages.push(outlineResult.usage);
    outlineText = outlineResult.output;
  }

  // ── Draft (seq=4 now) ──
  const draftPromptText = draftPrompt({
    goal: opts.goal, context: opts.context, plan,
    findings, outline: outlineText, thesis, language: opts.language,
  });

  let draftOutput: string;
  if (cache?.draftOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 4, branch: 0, kind: "draft", label: "Draft report (cached)",
      output: cache.draftOutput, usage: cache.draftUsage,
    });
    usages.push(cache.draftUsage);
    draftOutput = cache.draftOutput;
  } else {
    const draftPhase = store.addPhase({ turnId: opts.turnId, seq: 4, branch: 0, kind: "draft", label: "Draft report", createdAt: Date.now() });
    const draftResult = await runPhase({
      taskId: opts.taskId, phaseId: draftPhase.id, kind: "draft",
      prompt: draftPromptText,
    });
    usages.push(draftResult.usage);
    draftOutput = draftResult.output;
  }

  // ── Critique (seq=5 now) ──
  let critiqueOutput: string;
  if (cache?.critiqueOutput && thesisAvailable) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 5, branch: 0, kind: "critique", label: "Self-critique (cached)",
      output: cache.critiqueOutput, usage: cache.critiqueUsage,
    });
    usages.push(cache.critiqueUsage);
    critiqueOutput = cache.critiqueOutput;
  } else {
    const critiquePhase = store.addPhase({ turnId: opts.turnId, seq: 5, branch: 0, kind: "critique", label: "Self-critique", createdAt: Date.now() });
    const critiqueResult = await runPhaseLite({
      taskId: opts.taskId, phaseId: critiquePhase.id, kind: "critique",
      prompt: critiqueInstructionPrompt({ goal: opts.goal, thesis, outline: outlineText }),
      messages: [
        { role: "user", content: draftPromptText },
        { role: "assistant", content: draftOutput },
        { role: "user", content: critiqueInstructionPrompt({ goal: opts.goal, thesis, outline: outlineText }) },
      ],
    });
    usages.push(critiqueResult.usage);
    critiqueOutput = critiqueResult.output;
  }

  // ── Revise + quality loop (seqOffset starts at 6) ──
  let currentDraft = draftOutput;
  let currentCritique = critiqueOutput;
  let seqOffset = 6;
  let finalRevision = draftOutput;

  for (let iteration = 0; iteration <= MAX_QUALITY_ITERATIONS; iteration++) {
    const isRetry = iteration > 0;
    const reviseLabel = isRetry ? `Revision (iteration ${iteration + 1})` : "Final revision";

    const revisePhase = store.addPhase({ turnId: opts.turnId, seq: seqOffset, branch: 0, kind: "revise", label: reviseLabel, createdAt: Date.now() });
    const reviseResult = await runPhase({
      taskId: opts.taskId, phaseId: revisePhase.id, kind: "revise",
      prompt: reviseInstructionPrompt({
        goal: opts.goal, toolsets: opts.toolsets, language: opts.language,
        thesis, outline: outlineText,
      }),
      conversationHistory: [
        { role: "user", content: "Write a draft report." },
        { role: "assistant", content: currentDraft },
        { role: "user", content: "Critique this report." },
        { role: "assistant", content: currentCritique },
      ],
    });
    usages.push(reviseResult.usage);
    finalRevision = reviseResult.output;

    // D. Quality gate
    if (iteration < MAX_QUALITY_ITERATIONS) {
      const quality = await evaluateReportQuality(opts, reviseResult.output, thesis);
      broadcast(opts.taskId, {
        event: "pipeline.quality_check",
        data: { score: quality.score, pass: quality.pass, issues: quality.issues, iteration: iteration + 1 },
      });

      if (quality.pass) break;

      seqOffset += 2;
      currentDraft = reviseResult.output;

      const reCritiquePhase = store.addPhase({ turnId: opts.turnId, seq: seqOffset - 1, branch: 0, kind: "critique", label: `Re-critique (score: ${quality.score}/10)`, createdAt: Date.now() });
      const reCritiqueResult = await runPhaseLite({
        taskId: opts.taskId, phaseId: reCritiquePhase.id, kind: "critique",
        prompt: critiqueInstructionPrompt({ goal: opts.goal, thesis, outline: outlineText }),
        messages: [
          { role: "user", content: "Here is the revised report." },
          { role: "assistant", content: currentDraft },
          { role: "user", content: `The report scored ${quality.score}/10. Issues: ${quality.issues.join("; ")}. Provide a focused critique addressing these specific issues.` },
        ],
      });
      usages.push(reCritiqueResult.usage);
      currentCritique = reCritiqueResult.output;
    }
  }

  // ── Editor pass (seqOffset + 1) ──
  const editorPhase = store.addPhase({ turnId: opts.turnId, seq: seqOffset + 1, branch: 0, kind: "revise", label: "Copy edit", createdAt: Date.now() });
  const editorResult = await runPhaseLite({
    taskId: opts.taskId, phaseId: editorPhase.id, kind: "critique",
    prompt: editorPrompt({ goal: opts.goal, language: opts.language, thesisPresent: thesis !== null }),
    messages: [
      { role: "user", content: "Here is the final revised report." },
      { role: "assistant", content: finalRevision },
      { role: "user", content: editorPrompt({ goal: opts.goal, language: opts.language, thesisPresent: thesis !== null }) },
    ],
  });
  usages.push(editorResult.usage);

  return editorResult.output || finalRevision;
}

// ---------------------------------------------------------------------------
// A. Plan review gate — audit plan for structural defects before research.
// Runs as a visible phase (seq=0, branch=1, kind="critique") in deep mode.
// ---------------------------------------------------------------------------
interface PlanReviewVerdict {
  pass: boolean;
  score: number;
  issues: string[];
  rewriteHints: string[];
  output: string;
  usage?: TokenUsage;
}

function parsePlanReview(content: string): { pass: boolean; score: number; issues: string[]; rewriteHints: string[] } {
  const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
  const candidate = (jsonBlock ? jsonBlock[1] : content).trim();
  let parsed: { pass?: boolean; score?: number; issues?: unknown; rewrite_hints?: unknown };
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(candidate));
    } catch {
      return { pass: true, score: 7, issues: [], rewriteHints: [] };
    }
  }
  const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 5) : [];
  const rewriteHints = Array.isArray(parsed.rewrite_hints) ? parsed.rewrite_hints.map(String).slice(0, 5) : [];
  const score = typeof parsed.score === "number" ? parsed.score : 7;
  const pass = typeof parsed.pass === "boolean" ? parsed.pass : score >= 6;
  return { pass, score, issues, rewriteHints };
}

async function runPlanReview(
  opts: PipelineOpts,
  planOutput: string,
): Promise<PlanReviewVerdict> {
  const phase = store.addPhase({
    turnId: opts.turnId,
    seq: 0,
    branch: 1,
    kind: "critique",
    label: "Plan review",
    createdAt: Date.now(),
  });

  try {
    const result = await runPhaseLite({
      taskId: opts.taskId,
      phaseId: phase.id,
      kind: "critique",
      prompt: planReviewPrompt({ goal: opts.goal, planOutput, language: opts.language }),
    });
    const verdict = parsePlanReview(result.output);
    return { ...verdict, output: result.output, usage: result.usage };
  } catch {
    // On any failure, don't block the pipeline
    return { pass: true, score: 7, issues: [], rewriteHints: [], output: "", usage: undefined };
  }
}

// ---------------------------------------------------------------------------
// A2. Thesis phase — produce refutable central claim + sub_claims + section plan
// after research (and adequacy gate in deep mode).
// Runs as a visible phase (seq=2, kind="critique", label="Thesis").
// Returns parsed object or null on failure (degraded mode).
// ---------------------------------------------------------------------------
interface ThesisRunResult {
  output: string;
  usage?: TokenUsage;
  parsed: ParsedThesis | null;
}

async function runThesis(
  opts: PipelineOpts,
  seq: number,
  planSections: string[],
  findings: { questionId: string; title: string; output: string }[],
): Promise<ThesisRunResult> {
  const phase = store.addPhase({
    turnId: opts.turnId,
    seq,
    branch: 0,
    kind: "critique",
    label: "Thesis",
    createdAt: Date.now(),
  });

  try {
    const result = await runPhaseLite({
      taskId: opts.taskId,
      phaseId: phase.id,
      kind: "critique",
      prompt: thesisPrompt({
        goal: opts.goal,
        planSections,
        findings,
        language: opts.language,
      }),
    });
    const parsed = parseThesis(result.output);
    return { output: result.output, usage: result.usage, parsed };
  } catch {
    return { output: "", usage: undefined, parsed: null };
  }
}

// ---------------------------------------------------------------------------
// B. Research adequacy gate
// ---------------------------------------------------------------------------
const MAX_SUPPLEMENTARY_RESEARCH = 3;

async function evaluateResearchAdequacy(
  opts: PipelineOpts,
  plan: import("../../shared/types.ts").Plan,
  researchResults: { question: import("../../shared/types.ts").ResearchQuestion; output: string; usage?: TokenUsage }[],
  usages: (TokenUsage | undefined)[]
): Promise<import("../../shared/types.ts").ResearchQuestion[]> {
  try {
    const model = getModelForPhase("critique");
    const { content } = await hermesChat({
      message: researchAdequacyPrompt({
        goal: opts.goal,
        plan,
        findings: researchResults.map((r) => ({ questionId: r.question.id, title: r.question.title, output: r.output })),
      }),
      model,
    });

    const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
    const candidate = (jsonBlock ? jsonBlock[1] : content).trim();
    let parsed: { adequate?: boolean; gaps?: { questionId?: string; title?: string; issue?: string; approach?: string }[] };
    try { parsed = JSON.parse(candidate); } catch { try { parsed = JSON.parse(jsonrepair(candidate)); } catch { return []; } }

    if (parsed.adequate || !Array.isArray(parsed.gaps) || parsed.gaps.length === 0) return [];

    // Collect new questions from gaps
    const supplementary: import("../../shared/types.ts").ResearchQuestion[] = [];
    for (const gap of parsed.gaps.slice(0, MAX_SUPPLEMENTARY_RESEARCH)) {
      if (gap.questionId === "NEW" && gap.title) {
        supplementary.push({
          id: `S${supplementary.length + 1}`,
          title: gap.title,
          approach: gap.approach || "Search web and cite primary sources.",
        });
      }
    }
    return supplementary;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// D. Report quality self-evaluation loop
// ---------------------------------------------------------------------------
const MAX_QUALITY_ITERATIONS = 2;

async function evaluateReportQuality(
  opts: PipelineOpts,
  report: string,
  thesis: ParsedThesis | null,
): Promise<{ pass: boolean; score: number; issues: string[] }> {
  try {
    const model = getModelForPhase("critique");
    const { content } = await hermesChat({
      message: reportQualityPrompt({ goal: opts.goal, report, thesis }),
      model,
    });

    const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
    const candidate = (jsonBlock ? jsonBlock[1] : content).trim();
    let parsed: { pass?: boolean; score?: number; issues?: string[] };
    try { parsed = JSON.parse(candidate); } catch { try { parsed = JSON.parse(jsonrepair(candidate)); } catch { return { pass: true, score: 7, issues: [] }; } }

    return {
      pass: parsed.pass ?? (parsed.score !== undefined ? parsed.score >= 7 : true),
      score: parsed.score ?? 7,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 3) : [],
    };
  } catch {
    return { pass: true, score: 7, issues: [] };
  }
}

// Topologically partition research questions into parallel-safe levels.
// - Unknown deps (referencing nonexistent IDs) are dropped.
// - Cycles: remaining questions dumped into one level after MAX_LEVELS iterations.
// - Result preserves original ordering within each level.
function computeResearchLevels(
  questions: import("../../shared/types.ts").ResearchQuestion[]
): import("../../shared/types.ts").ResearchQuestion[][] {
  const ids = new Set(questions.map((q) => q.id));
  const levels: import("../../shared/types.ts").ResearchQuestion[][] = [];
  const assigned = new Set<string>();
  const MAX_LEVELS = Math.max(1, questions.length);

  while (assigned.size < questions.length) {
    const thisLevel = questions.filter((q) => {
      if (assigned.has(q.id)) return false;
      const deps = (q.depends_on ?? []).filter((d) => ids.has(d));
      return deps.every((d) => assigned.has(d));
    });

    if (thisLevel.length === 0) {
      // Cycle or unresolvable dep set — dump remaining into a final flat level
      const remaining = questions.filter((q) => !assigned.has(q.id));
      if (remaining.length > 0) levels.push(remaining);
      break;
    }

    levels.push(thisLevel);
    thisLevel.forEach((q) => assigned.add(q.id));

    if (levels.length >= MAX_LEVELS) {
      const remaining = questions.filter((q) => !assigned.has(q.id));
      if (remaining.length > 0) levels.push(remaining);
      break;
    }
  }
  return levels;
}

// Shared plan + research for standard/deep modes (with optional cache for retry)
async function runPlanAndResearch(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<{
  plan: import("../../shared/types.ts").Plan;
  researchResults: {
    question: import("../../shared/types.ts").ResearchQuestion;
    output: string;
    usage?: TokenUsage;
  }[];
}> {
  const isFollowup = Boolean(opts.priorReport && opts.followupMessage);
  const { taskId, turnId, goal, context, toolsets, cache } = opts;

  // ── Plan phase (skip if cached) ──
  let planOutput: string;
  if (cache?.planOutput) {
    replayPhase(turnId, taskId, {
      seq: 0, branch: 0, kind: "plan",
      label: isFollowup ? "Re-plan with refinement (cached)" : "Plan research (cached)",
      output: cache.planOutput, usage: cache.planUsage,
    });
    usages.push(cache.planUsage);
    planOutput = cache.planOutput;
  } else {
    const planPhase = store.addPhase({
      turnId, seq: 0, branch: 0, kind: "plan",
      label: isFollowup ? "Re-plan with refinement" : "Plan research",
      createdAt: Date.now(),
    });

    const priorKnowledge = searchPriorKnowledge(goal);
    const planPromptText = isFollowup
      ? planPrompt({ goal, context, toolsets, language: opts.language }) +
        priorKnowledge + "\n\n" +
        followupContextPrompt({ priorReport: opts.priorReport!, followupMessage: opts.followupMessage! })
      : planPrompt({ goal, context, toolsets, language: opts.language }) + priorKnowledge;

    const planResult = await runPhaseLite({ taskId, phaseId: planPhase.id, kind: "plan", prompt: planPromptText });
    usages.push(planResult.usage);
    planOutput = planResult.output;
  }

  let plan = parsePlan(planOutput) ?? {
    sections: ["TL;DR", "Details", "References"],
    questions: [{ id: "Q1", title: goal, approach: "Treat the full goal as one research thread; search web and cite primary sources." }],
  };

  // ── A. Plan review gate (standard + deep, max 1 revision) ──
  // Quick mode has no plan (direct report), so it never reaches here.
  {
    if (cache?.planReviewOutput) {
      replayPhase(turnId, taskId, {
        seq: 0, branch: 1, kind: "critique",
        label: "Plan review (cached)",
        output: cache.planReviewOutput, usage: cache.planReviewUsage,
      });
      usages.push(cache.planReviewUsage);
      // If the cached review rejected the plan, replay the cached revised plan too
      if (cache.planReviewPassed === false && cache.planRevisedOutput) {
        replayPhase(turnId, taskId, {
          seq: 0, branch: 2, kind: "plan",
          label: "Plan (revised, cached)",
          output: cache.planRevisedOutput, usage: cache.planRevisedUsage,
        });
        usages.push(cache.planRevisedUsage);
        planOutput = cache.planRevisedOutput;
        const reparsed = parsePlan(planOutput);
        if (reparsed) plan = reparsed;
      }
    } else {
      const review = await runPlanReview(opts, planOutput);
      usages.push(review.usage);

      if (!review.pass && review.rewriteHints.length > 0) {
        broadcast(taskId, {
          event: "pipeline.plan_revised",
          data: { score: review.score, issues: review.issues },
        });

        const revisedPhase = store.addPhase({
          turnId, seq: 0, branch: 2, kind: "plan",
          label: "Plan (revised)", createdAt: Date.now(),
        });

        const basePlanPrompt = planPrompt({ goal, context, toolsets, language: opts.language });
        const priorKnowledge = searchPriorKnowledge(goal);
        const revisionAppendix =
          `\n\n## Previous plan was rejected — fix these issues\n\n` +
          review.rewriteHints.map((h, i) => `${i + 1}. ${h}`).join("\n") +
          (review.issues.length > 0
            ? `\n\nIssues identified by reviewer:\n` + review.issues.map((i) => `- ${i}`).join("\n")
            : "");

        const revised = await runPhaseLite({
          taskId,
          phaseId: revisedPhase.id,
          kind: "plan",
          prompt: basePlanPrompt + priorKnowledge + revisionAppendix,
        });
        usages.push(revised.usage);
        planOutput = revised.output;
        const reparsed = parsePlan(planOutput);
        if (reparsed) plan = reparsed;
        // MAX_PLAN_REVISIONS = 1 — do not re-review.
      }
    }
  }

  const researchQuestions = plan.questions.slice(0, getMaxResearch());

  // ── Research phase (DAG-scheduled: respects depends_on) ──
  type ResearchResult = { question: import("../../shared/types.ts").ResearchQuestion; output: string; usage?: TokenUsage };

  const levels = computeResearchLevels(researchQuestions);
  const resultsById = new Map<string, ResearchResult>();
  const cachedResearch = cache?.researchByBranch;

  // Broadcast plan early (before level-0 runs) so UI can plot all branches.
  broadcast(taskId, {
    event: "pipeline.plan_parsed",
    data: { plan, researchPhaseIds: [] },
  });

  for (const levelQuestions of levels) {
    // Separate cached vs missing within this level
    const levelCached: ResearchResult[] = [];
    const levelMissing: { question: import("../../shared/types.ts").ResearchQuestion; index: number }[] = [];
    for (const q of levelQuestions) {
      const i = researchQuestions.findIndex((r) => r.id === q.id);
      const hit = cachedResearch?.get(i);
      if (hit) {
        replayPhase(turnId, taskId, { seq: 1, branch: i, kind: "research", label: `${q.id}: ${q.title} (cached)`, output: hit.output, usage: hit.usage });
        usages.push(hit.usage);
        levelCached.push({ question: q, output: hit.output, usage: hit.usage });
      } else {
        levelMissing.push({ question: q, index: i });
      }
    }
    levelCached.forEach((r) => resultsById.set(r.question.id, r));

    if (levelMissing.length === 0) continue;

    const newPhases = levelMissing.map(({ question: q, index: i }) =>
      store.addPhase({ turnId, seq: 1, branch: i, kind: "research", label: `${q.id}: ${q.title}`, createdAt: Date.now() })
    );

    const newResults = await Promise.all(
      levelMissing.map(({ question: q }, i) => {
        const prerequisites = (q.depends_on ?? [])
          .map((depId) => resultsById.get(depId))
          .filter((r): r is ResearchResult => Boolean(r))
          .map((r) => ({ id: r.question.id, title: r.question.title, output: r.output }));
        return runPhase({
          taskId,
          phaseId: newPhases[i].id,
          kind: "research",
          prompt: researchPrompt({ goal, question: q, context, prerequisites }),
        }).then((r) => ({ question: q, output: r.output, usage: r.usage }));
      })
    );
    newResults.forEach((r) => {
      usages.push(r.usage);
      resultsById.set(r.question.id, r);
    });

    for (const r of newResults) {
      extractPhaseKnowledge(taskId, r.question.title, r.output).catch(() => {});
    }
  }

  // Assemble in original plan order
  const researchResults: ResearchResult[] = researchQuestions
    .map((q) => resultsById.get(q.id))
    .filter((r): r is ResearchResult => Boolean(r));

  // ── B. Research adequacy gate (deep mode only) ──
  if (opts.mode === "deep") {
    const supplementary = await evaluateResearchAdequacy(opts, plan, researchResults, usages);
    if (supplementary.length > 0) {
      broadcast(taskId, { event: "pipeline.supplementary_research", data: { count: supplementary.length } });

      const nextBranch = researchResults.length;
      const supPhases = supplementary.map((q, i) =>
        store.addPhase({ turnId, seq: 1, branch: nextBranch + i, kind: "research", label: `${q.id}: ${q.title} (supplementary)`, createdAt: Date.now() })
      );

      const supResults = await Promise.all(
        supplementary.map((q, i) =>
          runPhase({ taskId, phaseId: supPhases[i].id, kind: "research", prompt: researchPrompt({ goal, question: q, context }) })
            .then((r) => ({ question: q, output: r.output, usage: r.usage }))
        )
      );
      supResults.forEach((r) => usages.push(r.usage));

      for (const r of supResults) {
        extractPhaseKnowledge(taskId, r.question.title, r.output).catch(() => {});
      }

      researchResults.push(...supResults);
    }
  }

  return { plan, researchResults };
}

// ---------------------------------------------------------------------------
// Task chains: trigger child tasks when parent completes
// ---------------------------------------------------------------------------
export async function triggerChains(parentTaskId: string): Promise<void> {
  const chains = store.getPendingChains(parentTaskId);
  if (chains.length === 0) return;

  const parent = store.getTask(parentTaskId);
  if (!parent || !parent.result) return;

  for (const chain of chains) {
    const childContext =
      chain.contextMode === "summary"
        ? parent.result.slice(0, 3000) // abbreviated
        : parent.result;

    const childGoal = chain.goalTemplate;
    const childId = `task_${crypto.randomUUID().replace(/-/g, "")}`;
    const createdAt = Date.now();

    // Chains are transformations of the parent report, not new research.
    // Default to quick mode (single call, no plan/research) unless explicitly
    // overridden via chain.mode. Toolsets are dropped by default so the child
    // doesn't pointlessly re-search what the parent already covered.
    const chainMode: TaskMode = (chain as { mode?: TaskMode }).mode || "quick";
    const chainToolsets = chainMode === "quick" ? [] : parent.toolsets;

    store.createTask({
      id: childId,
      goal: childGoal,
      context: `Based on prior research:\n\n${childContext}`,
      toolsets: chainToolsets,
      mode: chainMode,
      language: parent.language,
      createdAt,
    });

    const turn = store.addTurn({
      taskId: childId,
      userMessage: childGoal,
      createdAt,
    });

    store.markChainTriggered(chain.id, childId);

    broadcast(parentTaskId, {
      event: "chain.triggered",
      data: { chainId: chain.id, childTaskId: childId },
    });

    runPipeline({
      taskId: childId,
      turnId: turn.id,
      goal: childGoal,
      context: `Based on prior research:\n\n${childContext}`,
      toolsets: chainToolsets,
      mode: chainMode,
      language: parent.language,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Cancel all phases for a task
// ---------------------------------------------------------------------------
export function cancelTaskPhases(taskId: string) {
  const rows = db
    .prepare(
      `SELECT p.id
       FROM phases p
       JOIN turns t ON t.id = p.turn_id
       WHERE t.task_id = ? AND p.status = 'running'`
    )
    .all(taskId) as { id: number }[];
  for (const r of rows) cancelPhase(r.id);
}

// ---------------------------------------------------------------------------
// Resume: find any turns marked running on startup and either resume or mark failed
// For pipeline mode, we mark orphan turns failed (too complex to resume mid-pipeline).
// ---------------------------------------------------------------------------
export function resumeTracking() {
  // Mark orphan running phases as failed
  db.prepare(
    `UPDATE phases
     SET status = 'failed',
         error = 'Server restarted while phase was in flight',
         completed_at = ?
     WHERE status IN ('pending', 'running')`
  ).run(Date.now());

  // Mark their turns as failed if not already terminal
  db.prepare(
    `UPDATE turns
     SET status = 'failed',
         error = 'Pipeline interrupted by server restart',
         completed_at = ?
     WHERE status = 'running'`
  ).run(Date.now());
}
