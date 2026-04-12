import type { TaskStatus } from "../../types";

const statusConfig: Record<
  TaskStatus,
  { label: string; dot: string; bg: string; text: string }
> = {
  running: {
    label: "Running",
    dot: "bg-agent-active",
    bg: "bg-agent-active/10",
    text: "text-agent-thinking",
  },
  completed: {
    label: "Completed",
    dot: "bg-success",
    bg: "bg-success-dim",
    text: "text-success",
  },
  failed: {
    label: "Failed",
    dot: "bg-danger",
    bg: "bg-danger-dim",
    text: "text-danger",
  },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === "running" ? "animate-pulse" : ""}`}
      />
      {cfg.label}
    </span>
  );
}
