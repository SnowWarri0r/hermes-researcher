import { store, db } from "./db.ts";
import { streamHermesEvents, startHermesRun } from "./hermes.ts";
import {
  planPrompt,
  researchPrompt,
  draftPrompt,
  critiquePrompt,
  revisePrompt,
  directReportPrompt,
  followupContextPrompt,
  parsePlan,
} from "./prompt.ts";
import type {
  Phase,
  TaskMode,
  TaskEvent,
  TokenUsage,
} from "../../shared/types.ts";

const MAX_PARALLEL_RESEARCH = 5;

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
  prompt: string;
}): Promise<{ output: string; usage?: TokenUsage }> {
  const { taskId, phaseId, prompt } = opts;

  const runId = await startHermesRun(prompt);
  store.markPhaseRunning(phaseId, runId);

  broadcast(taskId, {
    event: "phase.started",
    data: { phaseId, runId },
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
// Pipeline orchestrator with mode selection
// ---------------------------------------------------------------------------
interface PipelineOpts {
  taskId: string;
  turnId: number;
  goal: string;
  context: string;
  toolsets: string[];
  mode: TaskMode;
  priorReport?: string;
  followupMessage?: string;
}

export async function runPipeline(opts: PipelineOpts): Promise<void> {
  const isFollowup = Boolean(opts.priorReport && opts.followupMessage);

  broadcast(opts.taskId, {
    event: "pipeline.started",
    data: { turnId: opts.turnId, mode: opts.mode, isFollowup },
  });

  const usages: (TokenUsage | undefined)[] = [];

  try {
    let finalReport = "";
    if (opts.mode === "quick") {
      finalReport = await runQuickMode(opts, usages);
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
    prompt: directReportPrompt({
      goal: opts.goal,
      context: opts.context,
      toolsets: opts.toolsets,
      priorReport: opts.priorReport,
      followupMessage: opts.followupMessage,
    }),
  });
  usages.push(result.usage);
  return result.output;
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
    prompt: draftPrompt({
      goal: opts.goal,
      context: opts.context,
      plan,
      findings: researchResults.map((r) => ({
        questionId: r.question.id,
        title: r.question.title,
        output: r.output,
      })),
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

  const draftPhase = store.addPhase({
    turnId: opts.turnId,
    seq: 2,
    branch: 0,
    kind: "draft",
    label: "Draft report",
    createdAt: Date.now(),
  });
  const draftResult = await runPhase({
    taskId: opts.taskId,
    phaseId: draftPhase.id,
    prompt: draftPrompt({
      goal: opts.goal,
      context: opts.context,
      plan,
      findings: researchResults.map((r) => ({
        questionId: r.question.id,
        title: r.question.title,
        output: r.output,
      })),
    }),
  });
  usages.push(draftResult.usage);

  const critiquePhase = store.addPhase({
    turnId: opts.turnId,
    seq: 3,
    branch: 0,
    kind: "critique",
    label: "Self-critique",
    createdAt: Date.now(),
  });
  const critiqueResult = await runPhase({
    taskId: opts.taskId,
    phaseId: critiquePhase.id,
    prompt: critiquePrompt({ goal: opts.goal, draft: draftResult.output }),
  });
  usages.push(critiqueResult.usage);

  const revisePhase = store.addPhase({
    turnId: opts.turnId,
    seq: 4,
    branch: 0,
    kind: "revise",
    label: "Final revision",
    createdAt: Date.now(),
  });
  const reviseResult = await runPhase({
    taskId: opts.taskId,
    phaseId: revisePhase.id,
    prompt: revisePrompt({
      goal: opts.goal,
      context: opts.context,
      draft: draftResult.output,
      critique: critiqueResult.output,
      toolsets: opts.toolsets,
    }),
  });
  usages.push(reviseResult.usage);
  return reviseResult.output;
}

// Shared plan + research for standard/deep modes
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
  const { taskId, turnId, goal, context, toolsets } = opts;

  const planPhase = store.addPhase({
    turnId,
    seq: 0,
    branch: 0,
    kind: "plan",
    label: isFollowup ? "Re-plan with refinement" : "Plan research",
    createdAt: Date.now(),
  });

  const planPromptText = isFollowup
    ? planPrompt({ goal, context, toolsets }) +
      "\n\n" +
      followupContextPrompt({
        priorReport: opts.priorReport!,
        followupMessage: opts.followupMessage!,
      })
    : planPrompt({ goal, context, toolsets });

  const planResult = await runPhase({
    taskId,
    phaseId: planPhase.id,
    prompt: planPromptText,
  });
  usages.push(planResult.usage);

  const plan = parsePlan(planResult.output) ?? {
    sections: ["TL;DR", "Details", "References"],
    questions: [
      {
        id: "Q1",
        title: goal,
        approach:
          "Treat the full goal as one research thread; search web and cite primary sources.",
      },
    ],
  };

  const researchQuestions = plan.questions.slice(0, MAX_PARALLEL_RESEARCH);
  const researchPhases: Phase[] = researchQuestions.map((q, i) =>
    store.addPhase({
      turnId,
      seq: 1,
      branch: i,
      kind: "research",
      label: `${q.id}: ${q.title}`,
      createdAt: Date.now(),
    })
  );

  broadcast(taskId, {
    event: "pipeline.plan_parsed",
    data: { plan, researchPhaseIds: researchPhases.map((p) => p.id) },
  });

  const researchResults = await Promise.all(
    researchQuestions.map((q, i) =>
      runPhase({
        taskId,
        phaseId: researchPhases[i].id,
        prompt: researchPrompt({ goal, question: q, context }),
      }).then((r) => ({ question: q, output: r.output, usage: r.usage }))
    )
  );
  researchResults.forEach((r) => usages.push(r.usage));

  return { plan, researchResults };
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
