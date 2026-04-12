import { useTaskStore } from "../../store/tasks";

type View = "tasks" | "settings";

export function Sidebar({
  view,
  onViewChange,
}: {
  view: View;
  onViewChange: (v: View) => void;
}) {
  const { tasks, connected } = useTaskStore();
  const running = tasks.filter((t) => t.status === "running").length;

  return (
    <aside className="w-[260px] h-full bg-carbon border-r border-charcoal flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-charcoal flex items-center gap-3">
        <div className="animate-pulse-glow text-emerald-signal text-xl font-bold">
          &#x26A1;
        </div>
        <div>
          <div className="text-sm font-semibold text-snow tracking-tight">
            Hermes
          </div>
          <div className="text-[11px] text-slate-steel">
            Subagent Dashboard
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-3 space-y-1">
        <SidebarItem
          label="Tasks"
          active={view === "tasks"}
          badge={running > 0 ? running : undefined}
          onClick={() => onViewChange("tasks")}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4h10M3 8h10M3 12h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
        <SidebarItem
          label="Settings"
          active={view === "settings"}
          onClick={() => onViewChange("settings")}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8 2v2M8 12v2M2 8h2M12 8h2M3.76 3.76l1.41 1.41M10.83 10.83l1.41 1.41M3.76 12.24l1.41-1.41M10.83 5.17l1.41-1.41"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      </nav>

      {/* Connection status */}
      <div className="px-4 py-3 border-t border-charcoal">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`}
          />
          <span className="text-slate-steel">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  label,
  active,
  badge,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: number;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-emerald-dim text-emerald-signal"
          : "text-parchment hover:bg-carbon-hover hover:text-snow"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && (
        <span className="bg-agent-active/20 text-agent-thinking text-xs font-medium px-1.5 py-0.5 rounded-pill">
          {badge}
        </span>
      )}
    </button>
  );
}
