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
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterStatus(f.value)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                filterStatus === f.value
                  ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                  : "bg-carbon border-charcoal text-slate-steel hover:text-parchment hover:border-charcoal-light"
              }`}
            >
              {f.label}
            </button>
          ))}
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
