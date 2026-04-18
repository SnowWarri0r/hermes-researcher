import crypto from "node:crypto";
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
  critiquePrompt,
  critiqueInstructionPrompt,
  revisePrompt,
  reviseInstructionPrompt,
  directReportPrompt,
  followupContextPrompt,
  parsePlan,
  isMinorRefinement,
} from "./prompt.ts";
import type {
  Phase,
  PhaseKind,
  TaskMode,
  TaskEvent,
  TokenUsage,
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
      const isNoise = event.event === "message.delta";
      if (!isNoise) {
        store.appendEvent(runId, event);
      }
      broadcast(taskId, {
        event: event.event,
        data: { ...event, phaseId, runId },
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

    // Consume the event stream, broadcasting deltas for real-time display
    for await (const event of stream.events) {
      if (event.event === "message.delta" && event.delta) {
        broadcast(taskId, {
          event: "message.delta",
          data: { phaseId, delta: event.delta, kind },
        });
      }
    }

    const completedAt = Date.now();
    const output = stream.content;
    const usage = stream.usage;

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
  researchByBranch?: Map<number, { output: string; usage?: TokenUsage; label: string }>;
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

// ── Standard: plan → parallel research → draft ──────────────────────────────
async function runStandardMode(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const { plan, researchResults } = await runPlanAndResearch(opts, usages);

  const draftPhase = store.addPhase({
    turnId: opts.turnId,
    seq: 2,
    branch: 0,
    kind: "draft",
    label: "Write report",
    createdAt: Date.now(),
  });

  const result = await runPhase({
    taskId: opts.taskId,
    phaseId: draftPhase.id,
    kind: "draft",
    prompt: draftPrompt({
      goal: opts.goal,
      context: opts.context,
      plan,
      findings: researchResults.map((r) => ({
        questionId: r.question.id,
        title: r.question.title,
        output: r.output,
      })),
      language: opts.language,
    }),
  });
  usages.push(result.usage);
  return result.output;
}

// ── Deep: plan → research → draft → critique → revise ──────────────────────
async function runDeepMode(
  opts: PipelineOpts,
  usages: (TokenUsage | undefined)[]
): Promise<string> {
  const { plan, researchResults } = await runPlanAndResearch(opts, usages);
  const { cache } = opts;

  // ── Draft (skip if cached) ──
  const draftPromptText = draftPrompt({
    goal: opts.goal, context: opts.context, plan,
    findings: researchResults.map((r) => ({ questionId: r.question.id, title: r.question.title, output: r.output })),
    language: opts.language,
  });

  let draftOutput: string;
  if (cache?.draftOutput) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 2, branch: 0, kind: "draft", label: "Draft report (cached)",
      output: cache.draftOutput, usage: cache.draftUsage,
    });
    usages.push(cache.draftUsage);
    draftOutput = cache.draftOutput;
  } else {
    const draftPhase = store.addPhase({ turnId: opts.turnId, seq: 2, branch: 0, kind: "draft", label: "Draft report", createdAt: Date.now() });
    const draftResult = await runPhase({
      taskId: opts.taskId, phaseId: draftPhase.id, kind: "draft",
      prompt: draftPromptText,
    });
    usages.push(draftResult.usage);
    draftOutput = draftResult.output;
  }

  // ── Critique (skip if cached) ──
  // Use slim instruction + conversation history to avoid re-sending the draft
  let critiqueOutput: string;
  if (cache?.critiqueOutput) {
    replayPhase(opts.turnId, opts.taskId, {
      seq: 3, branch: 0, kind: "critique", label: "Self-critique (cached)",
      output: cache.critiqueOutput, usage: cache.critiqueUsage,
    });
    usages.push(cache.critiqueUsage);
    critiqueOutput = cache.critiqueOutput;
  } else {
    const critiquePhase = store.addPhase({ turnId: opts.turnId, seq: 3, branch: 0, kind: "critique", label: "Self-critique", createdAt: Date.now() });
    const critiqueResult = await runPhaseLite({
      taskId: opts.taskId, phaseId: critiquePhase.id, kind: "critique",
      prompt: critiqueInstructionPrompt({ goal: opts.goal }),
      messages: [
        { role: "user", content: draftPromptText },
        { role: "assistant", content: draftOutput },
        { role: "user", content: critiqueInstructionPrompt({ goal: opts.goal }) },
      ],
    });
    usages.push(critiqueResult.usage);
    critiqueOutput = critiqueResult.output;
  }

  // ── Revise ──
  // Use conversation_history to carry draft + critique, slim instruction as input
  const revisePhase = store.addPhase({ turnId: opts.turnId, seq: 4, branch: 0, kind: "revise", label: "Final revision", createdAt: Date.now() });
  const reviseResult = await runPhase({
    taskId: opts.taskId, phaseId: revisePhase.id, kind: "revise",
    prompt: reviseInstructionPrompt({
      goal: opts.goal, toolsets: opts.toolsets, language: opts.language,
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

  const plan = parsePlan(planOutput) ?? {
    sections: ["TL;DR", "Details", "References"],
    questions: [{ id: "Q1", title: goal, approach: "Treat the full goal as one research thread; search web and cite primary sources." }],
  };

  const researchQuestions = plan.questions.slice(0, getMaxResearch());

  // ── Research phase (replay cached branches, run missing ones) ──
  const cachedResearch = cache?.researchByBranch;
  const cachedResults: { question: import("../../shared/types.ts").ResearchQuestion; output: string; usage?: TokenUsage }[] = [];
  const missingBranches: { question: import("../../shared/types.ts").ResearchQuestion; index: number }[] = [];

  for (let i = 0; i < researchQuestions.length; i++) {
    const q = researchQuestions[i];
    const hit = cachedResearch?.get(i);
    if (hit) {
      replayPhase(turnId, taskId, { seq: 1, branch: i, kind: "research", label: `${q.id}: ${q.title} (cached)`, output: hit.output, usage: hit.usage });
      usages.push(hit.usage);
      cachedResults.push({ question: q, output: hit.output, usage: hit.usage });
    } else {
      missingBranches.push({ question: q, index: i });
    }
  }

  if (missingBranches.length > 0) {
    const newPhases = missingBranches.map(({ question: q, index: i }) =>
      store.addPhase({ turnId, seq: 1, branch: i, kind: "research", label: `${q.id}: ${q.title}`, createdAt: Date.now() })
    );

    broadcast(taskId, {
      event: "pipeline.plan_parsed",
      data: { plan, researchPhaseIds: newPhases.map((p) => p.id) },
    });

    const newResults = await Promise.all(
      missingBranches.map(({ question: q }, i) =>
        runPhase({ taskId, phaseId: newPhases[i].id, kind: "research", prompt: researchPrompt({ goal, question: q, context }) })
          .then((r) => ({ question: q, output: r.output, usage: r.usage }))
      )
    );
    newResults.forEach((r) => usages.push(r.usage));

    for (const r of newResults) {
      extractPhaseKnowledge(taskId, r.question.title, r.output).catch(() => {});
    }

    // Merge in original order
    const allResults = [...cachedResults, ...newResults].sort((a, b) => {
      const ai = researchQuestions.findIndex((q) => q.id === a.question.id);
      const bi = researchQuestions.findIndex((q) => q.id === b.question.id);
      return ai - bi;
    });
    return { plan, researchResults: allResults };
  }

  // All research was cached (or no missing branches above created new results)
  if (cachedResults.length > 0) {
    return { plan, researchResults: cachedResults };
  }

  // No cache at all — original flow
  const researchPhases: Phase[] = researchQuestions.map((q, i) =>
    store.addPhase({ turnId, seq: 1, branch: i, kind: "research", label: `${q.id}: ${q.title}`, createdAt: Date.now() })
  );

  broadcast(taskId, {
    event: "pipeline.plan_parsed",
    data: { plan, researchPhaseIds: researchPhases.map((p) => p.id) },
  });

  const researchResults = await Promise.all(
    researchQuestions.map((q, i) =>
      runPhase({ taskId, phaseId: researchPhases[i].id, kind: "research", prompt: researchPrompt({ goal, question: q, context }) })
        .then((r) => ({ question: q, output: r.output, usage: r.usage }))
    )
  );
  researchResults.forEach((r) => usages.push(r.usage));

  for (const r of researchResults) {
    extractPhaseKnowledge(taskId, r.question.title, r.output).catch(() => {});
  }

  return { plan, researchResults };
}

// ---------------------------------------------------------------------------
// Task chains: trigger child tasks when parent completes
// ---------------------------------------------------------------------------
async function triggerChains(parentTaskId: string): Promise<void> {
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

    store.createTask({
      id: childId,
      goal: childGoal,
      context: `Based on prior research:\n\n${childContext}`,
      toolsets: parent.toolsets,
      mode: parent.mode,
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
      toolsets: parent.toolsets,
      mode: parent.mode,
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
