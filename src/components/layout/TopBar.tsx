import { useTaskStore } from "../../store/tasks";
import { StatCard } from "../common/StatCard";

export function TopBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  return (
    <header className="h-14 border-b border-charcoal bg-carbon px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <StatCard label="Active" value={running} />
        <StatCard label="Done" value={completed} />
        {failed > 0 && <StatCard label="Failed" value={failed} />}
      </div>
    </header>
  );
}
