import type { Task, TaskMode } from "../../types";
import { StatusBadge } from "../common/Badge";
import { useTaskStore } from "../../store/tasks";

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const MODE_LABEL: Record<TaskMode, string> = {
  quick: "Q",
  standard: "S",
  deep: "D",
};

export function TaskCard({ task }: { task: Task }) {
  const removeTask = useTaskStore((s) => s.removeTask);
  const openTask = useTaskStore((s) => s.openTask);
  const togglePin = useTaskStore((s) => s.togglePin);

  const duration =
    task.completedAt && task.createdAt
      ? ((task.completedAt - task.createdAt) / 1000).toFixed(1)
      : null;

  const previewLine = task.result
    ? task.result.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || ""
    : "";

  const borderClass =
    task.status === "running"
      ? "border-agent-active/40"
      : task.status === "completed"
        ? "border-charcoal hover:border-charcoal-light"
        : task.status === "failed"
          ? "border-danger/30"
          : "border-charcoal";

  const p = task.progress;

  return (
    <div
      onClick={() => openTask(task.id)}
      className={`group bg-carbon border ${borderClass} rounded-lg transition-colors animate-fade-in cursor-pointer hover:bg-carbon-light`}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-snow line-clamp-2 leading-snug">
            {task.goal}
          </div>

          {previewLine && (
            <div className="mt-1.5 text-[12px] text-parchment line-clamp-1">
              {previewLine}
            </div>
          )}

          {/* Pipeline progress bar */}
          {p && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 bg-charcoal-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-agent-active rounded-full transition-all duration-500"
                  style={{ width: `${(p.done / p.total) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-agent-thinking font-mono shrink-0 animate-pulse">
                {p.current.length > 30 ? p.current.slice(0, 30) + "…" : p.current}
              </span>
              <span className="text-[10px] text-slate-steel font-mono shrink-0">
                {p.done}/{p.total}
              </span>
            </div>
          )}

          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <StatusBadge status={task.status} />
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-carbon-hover text-slate-steel border border-charcoal-subtle"
              title={task.mode}
            >
              {MODE_LABEL[task.mode]}
            </span>
            {task.turnCount > 1 && (
              <span className="text-[11px] font-mono text-emerald-signal">
                v{task.turnCount}
              </span>
            )}
            {duration && (
              <span className="text-[11px] font-mono text-slate-steel">
                {duration}s
              </span>
            )}
            {task.usage?.total_tokens !== undefined && (
              <span className="text-[11px] font-mono text-slate-steel">
                {formatTokens(task.usage.total_tokens)} tok
              </span>
            )}
            <span className="text-[11px] text-slate-steel/60 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              click to open →
            </span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePin(task.id);
            }}
            className={`text-xs p-1 transition-colors ${
              task.pinned
                ? "text-warning"
                : "text-slate-steel/40 opacity-0 group-hover:opacity-100 hover:text-warning"
            }`}
            title={task.pinned ? "Unpin" : "Pin"}
          >
            ★
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeTask(task.id);
            }}
            className="text-slate-steel hover:text-danger text-xs p-1 transition-colors opacity-0 group-hover:opacity-100"
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
