import { NavLink } from "react-router";
import { useMemo } from "react";
import { useTaskStore } from "../../store/tasks";

export function Sidebar() {
  const { tasks, connected, counts } = useTaskStore();
  const running = counts.running;

  const todayTokens = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let sum = 0;
    for (const t of tasks) {
      if ((t.completedAt ?? t.createdAt) >= startOfToday) {
        sum += t.usage?.total_tokens ?? 0;
      }
    }
    return sum;
  }, [tasks]);

  return (
    <aside className="w-[260px] h-full bg-carbon border-r border-charcoal flex flex-col shrink-0 relative z-[2]">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-charcoal flex items-center gap-3">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          className="text-emerald-signal animate-pulse-glow shrink-0"
          aria-hidden="true"
        >
          <path
            d="M13 2L3 14h7l-1 8 11-14h-7l0-6z"
            fill="currentColor"
          />
        </svg>
        <div>
          <div className="text-sm font-semibold text-snow tracking-tight leading-none">
            HERMES
          </div>
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.14em] mt-1">
            RESEARCHER
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-3 space-y-1">
        <SidebarLink
          to="/"
          label="Tasks"
          badge={running > 0 ? running : undefined}
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
        <SidebarLink
          to="/knowledge"
          label="Knowledge"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 3h12M2 7h8M2 11h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="13" cy="11" r="2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          }
        />
        <SidebarLink
          to="/schedules"
          label="Schedules"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
        <SidebarLink
          to="/settings"
          label="Settings"
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

      {/* System status block */}
      <div className="border-t border-charcoal px-3 py-3 space-y-2">
        <StatusRow
          label="GATEWAY"
          value={connected ? "online" : "offline"}
          online={connected}
        />
        <StatusRow
          label="PIPELINE"
          value={running > 0 ? `${running} running` : "idle"}
          online={running > 0}
          pulse={running > 0}
        />
        <div className="bg-abyss border border-charcoal-subtle rounded-md px-3 py-2.5 mt-2">
          <div className="text-[9px] text-slate-steel font-mono tracking-[0.14em] mb-1">TODAY · USAGE</div>
          <div className="font-mono text-snow text-[17px] leading-none">
            {formatTokens(todayTokens)}
            <span className="text-slate-steel text-[11px] ml-1">tok</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function StatusRow({
  label,
  value,
  online,
  pulse,
}: {
  label: string;
  value: string;
  online: boolean;
  pulse?: boolean;
}) {
  const dot = online ? "bg-emerald-signal" : "bg-danger/70";
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`}
        style={pulse ? { boxShadow: "0 0 8px currentColor", color: "var(--color-emerald-signal)" } : undefined}
      />
      <span className="text-[10px] font-mono text-slate-steel tracking-[0.14em] flex-1">{label}</span>
      <span className={`text-[10px] font-mono ${online ? "text-snow" : "text-slate-steel"}`}>{value}</span>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  badge,
  icon,
}: {
  to: string;
  label: string;
  badge?: number;
  icon: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors border-l-2 ${
          isActive
            ? "bg-emerald-dim text-emerald-signal border-emerald-signal"
            : "text-parchment hover:bg-carbon-hover hover:text-snow border-transparent"
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && (
        <span className="bg-agent-active/20 text-agent-thinking text-xs font-medium px-1.5 py-0.5 rounded-pill">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
