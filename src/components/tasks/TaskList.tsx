import { useState, useEffect, useRef } from "react";
import { useTaskStore } from "../../store/tasks";
import { TaskCard } from "./TaskCard";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Done" },
  { value: "failed", label: "Failed" },
];

export function TaskList() {
  const tasks = useTaskStore((s) => s.tasks);
  const clearCompleted = useTaskStore((s) => s.clearCompleted);
  const setSearch = useTaskStore((s) => s.setSearch);
  const setFilterStatus = useTaskStore((s) => s.setFilterStatus);
  const filterStatus = useTaskStore((s) => s.filterStatus);

  const [localQuery, setLocalQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(localQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [localQuery, setSearch]);

  const hasCompleted = tasks.some(
    (t) => t.status === "completed" || t.status === "failed"
  );

  // Counts derived from loaded tasks. For typical use (all tasks fit in a page)
  // this matches the server-side totals; if paginated heavily it's approximate.
  const counts: Record<string, number> = { "": tasks.length };
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  return (
    <div>
      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <input
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full bg-carbon border border-charcoal rounded-md pl-8 pr-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-steel"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => {
            const active = filterStatus === f.value;
            const n = counts[f.value] ?? 0;
            return (
              <button
                key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`px-2.5 py-1.5 rounded-pill text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
                  active
                    ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                    : "bg-carbon border-charcoal text-slate-steel hover:text-parchment hover:border-charcoal-light"
                }`}
              >
                <span>{f.label}</span>
                <span className={`text-[10px] font-mono ${active ? "text-emerald-signal/80" : "text-slate-steel/70"}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {hasCompleted && !filterStatus && (
          <button
            onClick={clearCompleted}
            className="text-xs text-slate-steel hover:text-parchment transition-colors shrink-0"
          >
            Clear done
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="text-3xl mb-3 opacity-20">⚡</div>
            <div className="text-sm text-slate-steel">
              {localQuery || filterStatus ? "No matching tasks" : "No tasks yet"}
            </div>
            {!localQuery && !filterStatus && (
              <div className="text-xs text-slate-steel/60 mt-1">
                Create a task above to dispatch a subagent
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
