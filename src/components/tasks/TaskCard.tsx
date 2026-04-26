import { useNavigate } from "react-router";
import type { Task, TaskMode } from "../../types";
import { Tooltip } from "../common/Tooltip";
import { UsageTooltip } from "../common/UsageTooltip";
import { useTaskStore } from "../../store/tasks";

const PIPELINE_PHASES = ["plan", "research", "draft", "critique", "revise"] as const;
type PhaseKey = (typeof PIPELINE_PHASES)[number];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const MODE_LABEL: Record<TaskMode, string> = {
  quick: "QUICK",
  standard: "STD",
  deep: "DEEP",
};

/**
 * Map the running phase's label (which can be "Plan", "Plan review",
 * "Q2: ...", "Thesis", "Outline", "Draft report", "Self-critique",
 * "Final revision", "Copy edit", etc.) to one of the 5 visible pipeline
 * segments shown in the mini bar.
 */
function phaseFromProgressLabel(label: string): PhaseKey | null {
  if (!label) return null;
  const l = label.toLowerCase().trim();
  // Research branches use "Q1: ...", "Q2: ..."
  if (/^q\d+/i.test(label)) return "research";
  if (l.startsWith("research")) return "research";
  // Plan + plan review both belong to the plan segment
  if (l.startsWith("plan")) return "plan";
  // Synthesis stack collapses into the "draft" segment
  if (l.startsWith("thesis") || l.startsWith("outline") || l.includes("draft")) return "draft";
  // Critique variants
  if (l.includes("critique") || l.startsWith("re-critique") || l.includes("self-critique")) return "critique";
  // Revise / editor / final
  if (l.includes("revis") || l.includes("editor") || l.includes("copy edit") || l.includes("final"))
    return "revise";
  return null;
}

export function TaskCard({ task }: { task: Task }) {
  const navigate = useNavigate();
  const removeTask = useTaskStore((s) => s.removeTask);
  const openTask = useTaskStore((s) => s.openTask);
  const togglePin = useTaskStore((s) => s.togglePin);

  const duration =
    task.completedAt && task.createdAt
      ? ((task.completedAt - task.createdAt) / 1000)
      : null;

  const totalTokens =
    (task.usage?.input_tokens ?? 0) + (task.usage?.output_tokens ?? 0);

  const isRunning = task.status === "running";
  const isFailed = task.status === "failed";
  const isDone = task.status === "completed";

  const p = task.progress;
  const currentPhase = p ? phaseFromProgressLabel(p.current) : null;
  const progressFrac = p ? p.done / Math.max(p.total, 1) : isDone ? 1 : isFailed ? 1 : 0;
  const phaseLabel = isDone
    ? "done"
    : isFailed
      ? "failed"
      : p
        ? p.current
        : "queued";

  // Mini segments are stage-based (plan/research/draft/critique/revise).
  // Sub-task progress (e.g. 4 of 5 research Q's done) lives in the per-row
  // 3px progress bar on the left, which uses progress.done/progress.total.
  const miniDoneIdx = isDone
    ? PIPELINE_PHASES.length
    : currentPhase
      ? PIPELINE_PHASES.indexOf(currentPhase)
      : -1;

  const borderClass = isRunning
    ? "border-emerald-signal/30 border-l-2 border-l-emerald-signal"
    : isFailed
      ? "border-danger/30"
      : "border-charcoal hover:border-charcoal-light";
  const bgClass = isRunning ? "bg-carbon-hover" : "bg-carbon";

  return (
    <div
      onClick={() => { openTask(task.id); navigate(`/tasks/${task.id}`); }}
      className={`group relative rounded-lg border ${borderClass} ${bgClass} transition-colors animate-fade-in cursor-pointer`}
    >
      {isRunning && (
        <span className="absolute top-2 right-3 text-[9px] text-emerald-signal font-mono tracking-[0.2em]">
          ● LIVE
        </span>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_90px_110px_60px] gap-4 px-4 py-3.5 items-center">
        {/* Goal column — tags + goal text + progress bar */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {task.pinned && <span className="text-warning text-xs">★</span>}
            {task.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] text-emerald-signal font-mono">
                #{t}
              </span>
            ))}
            {isFailed && (
              <span className="text-[9px] text-danger font-mono tracking-[0.2em]">FAILED</span>
            )}
          </div>
          <div className="text-[14px] text-snow leading-[1.35] tracking-[-0.005em] line-clamp-2 mb-2">
            {task.goal}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex-1 relative h-[3px] bg-charcoal rounded-sm overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isRunning ? "bg-emerald-signal/70" : isFailed ? "bg-danger/60" : "bg-emerald-signal"
                }`}
                style={{ width: `${Math.min(100, Math.round(progressFrac * 100))}%` }}
              />
              {isRunning && (
                <span
                  className="absolute top-[-2px] w-[2px] h-[7px] bg-emerald-signal"
                  style={{
                    left: `${Math.min(100, Math.round(progressFrac * 100))}%`,
                    boxShadow: "0 0 8px var(--color-emerald-signal)",
                  }}
                />
              )}
            </div>
            <span
              className={`text-[10px] font-mono shrink-0 ${
                isRunning ? "text-emerald-signal" : isFailed ? "text-danger" : "text-slate-steel"
              }`}
            >
              {phaseLabel.length > 22 ? phaseLabel.slice(0, 22) + "…" : phaseLabel}
            </span>
          </div>
        </div>

        {/* Pipeline mini bars */}
        <PipelineMini doneIdx={miniDoneIdx} isDone={isDone} isFailed={isFailed} />

        {/* Duration */}
        <span className="text-[11px] text-parchment font-mono">
          {duration !== null ? `${duration < 60 ? duration.toFixed(1) + "s" : Math.floor(duration / 60) + "m " + Math.round(duration % 60) + "s"}` : "—"}
        </span>

        {/* Tokens */}
        {totalTokens > 0 ? (
          <Tooltip content={<UsageTooltip usage={task.usage} />} className="inline-flex items-center">
            <span className="text-[11px] text-parchment font-mono cursor-help">
              {formatTokens(totalTokens)}
            </span>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-slate-steel/60 font-mono">—</span>
        )}

        {/* Mode */}
        <span className="text-[10px] text-slate-steel font-mono tracking-[0.15em]">
          {MODE_LABEL[task.mode]}
          {task.turnCount > 1 && (
            <span className="text-emerald-signal ml-1">·v{task.turnCount}</span>
          )}
        </span>
      </div>

      {/* Hover row actions — pin / delete (top right under LIVE badge) */}
      <div className="absolute top-2 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isRunning && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); togglePin(task.id); }}
              className={`text-xs p-1 transition-colors ${
                task.pinned ? "text-warning" : "text-slate-steel/60 hover:text-warning"
              }`}
              title={task.pinned ? "Unpin" : "Pin"}
            >
              ★
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); removeTask(task.id); }}
              className="text-slate-steel/60 hover:text-danger text-xs p-1 transition-colors"
              title="Remove"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PipelineMini({
  doneIdx,
  isDone,
  isFailed,
}: {
  doneIdx: number;
  isDone: boolean;
  isFailed: boolean;
}) {
  return (
    <div className="hidden md:flex gap-[2px] items-center">
      {PIPELINE_PHASES.map((phase, i) => {
        const done = i < doneIdx;
        const now = i === doneIdx && !isDone && !isFailed;
        const fail = isFailed && i === doneIdx;
        return (
          <span
            key={phase}
            className="flex-1 h-[14px] rounded-sm"
            style={{
              background: done
                ? "var(--color-emerald-signal)"
                : now
                  ? "color-mix(in srgb, var(--color-emerald-signal) 60%, transparent)"
                  : fail
                    ? "var(--color-danger)"
                    : "var(--color-charcoal)",
              opacity: done ? 0.9 : 1,
              boxShadow: now ? "0 0 8px var(--color-emerald-signal)" : "none",
            }}
            title={phase}
          />
        );
      })}
    </div>
  );
}
