import { useState, useEffect, useMemo } from "react";

const API = "/api";

interface ScheduleItem {
  id: string;
  name: string;
  goal: string;
  context: string;
  mode: string;
  language: string;
  toolsets: string[];
  cron: string;
  discordWebhook: string;
  enabled: boolean;
  lastRunAt?: number;
  lastTaskId?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/**
 * Parse a 5-field cron and return today's trigger times (in ms-of-day).
 * Supported subset: literal `n`, ranges `a-b`, lists `a,b`, step `* /n`,
 * and `*` wildcards. Returns [] when expression is unsupported.
 */
function expandField(expr: string, min: number, max: number): number[] | null {
  if (expr === "*") {
    const out = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  // Step: "* /n" or "a-b/n"
  const stepMatch = expr.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
  if (stepMatch) {
    const lo = stepMatch[1] === "*" ? min : Number(stepMatch[2]);
    const hi = stepMatch[1] === "*" ? max : Number(stepMatch[3]);
    const step = Number(stepMatch[4]);
    const out = [];
    for (let i = lo; i <= hi; i += step) out.push(i);
    return out;
  }
  // List
  if (expr.includes(",")) {
    const parts = expr.split(",").map((p) => expandField(p, min, max));
    if (parts.some((p) => p === null)) return null;
    return parts.flat() as number[];
  }
  // Range
  const range = expr.match(/^(\d+)-(\d+)$/);
  if (range) {
    const out = [];
    for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(i);
    return out;
  }
  // Literal
  if (/^\d+$/.test(expr)) return [Number(expr)];
  return null;
}

/** Today's trigger millisecond offsets from midnight, for cron, in DOW today. */
function cronTodayTriggers(cron: string): number[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [m, h, dom, mon, dow] = parts;
  const minutes = expandField(m, 0, 59);
  const hours = expandField(h, 0, 23);
  const doms = expandField(dom, 1, 31);
  const mons = expandField(mon, 1, 12);
  const dows = expandField(dow, 0, 6);
  if (!minutes || !hours || !doms || !mons || !dows) return [];

  const now = new Date();
  const today = now.getDate();
  const month = now.getMonth() + 1;
  const todayDow = now.getDay();
  if (!doms.includes(today)) return [];
  if (!mons.includes(month)) return [];
  if (!dows.includes(todayDow)) return [];

  const out: number[] = [];
  for (const hh of hours) for (const mm of minutes) out.push(hh * HOUR_MS + mm * MIN_MS);
  return out.sort((a, b) => a - b);
}

/** Next trigger across the next 7 days. Returns absolute timestamp or null. */
function cronNextTrigger(cron: string): number | null {
  const now = Date.now();
  const today = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + dayOffset,
    ).getTime();
    // Build cron with that day's dow
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [m, h, dom, mon, dow] = parts;
    const minutes = expandField(m, 0, 59);
    const hours = expandField(h, 0, 23);
    const doms = expandField(dom, 1, 31);
    const mons = expandField(mon, 1, 12);
    const dows = expandField(dow, 0, 6);
    if (!minutes || !hours || !doms || !mons || !dows) return null;
    const d = new Date(dayStart);
    if (!doms.includes(d.getDate())) continue;
    if (!mons.includes(d.getMonth() + 1)) continue;
    if (!dows.includes(d.getDay())) continue;
    for (const hh of hours)
      for (const mm of minutes) {
        const ts = dayStart + hh * HOUR_MS + mm * MIN_MS;
        if (ts > now) return ts;
      }
  }
  return null;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m}m`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}

function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, dom, mon, dow] = parts;
  const time =
    /^\d+$/.test(h) && /^\d+$/.test(m)
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      : `${h}:${m}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${time}`;
  if (dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${time}`;
  if (dom === "*" && mon === "*" && dow === "0,6") return `Weekends at ${time}`;
  if (dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${names[Number(dow)]} at ${time}`;
  }
  return cron;
}

export function Schedules() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    goal: "",
    context: "",
    mode: "deep",
    language: "",
    cron: "0 9 * * *",
    discordWebhook: "",
  });
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    reload();
  }, []);

  function reload() {
    fetch(`${API}/schedules`)
      .then((r) => r.json())
      .then(setSchedules)
      .catch(() => {});
  }

  async function handleCreate() {
    if (!form.name || !form.goal || !form.cron) return;
    await fetch(`${API}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, toolsets: [], enabled: true }),
    });
    setForm({
      name: "",
      goal: "",
      context: "",
      mode: "deep",
      language: "",
      cron: "0 9 * * *",
      discordWebhook: "",
    });
    setShowForm(false);
    reload();
  }

  async function handleToggle(id: string, enabled: boolean) {
    await fetch(`${API}/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    reload();
  }

  async function handleDelete(id: string) {
    await fetch(`${API}/schedules/${id}`, { method: "DELETE" });
    reload();
  }

  async function handleTrigger(id: string) {
    setTriggering(id);
    try {
      await fetch(`${API}/schedules/${id}/trigger`, { method: "POST" });
    } catch {
      /* ignore */
    }
    setTriggering(null);
    reload();
  }

  const enabledSchedules = schedules.filter((s) => s.enabled);
  const nextUp = useMemo(() => {
    let earliest: { id: string; ts: number } | null = null;
    for (const s of enabledSchedules) {
      const t = cronNextTrigger(s.cron);
      if (t !== null && (earliest === null || t < earliest.ts)) {
        earliest = { id: s.id, ts: t };
      }
    }
    return earliest;
  }, [enabledSchedules]);

  const now = Date.now();
  const headerNextLabel = nextUp ? `next in ${formatDuration(nextUp.ts - now)}` : "no upcoming";

  return (
    <div>
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-5">
        <div>
          <div className="text-[11px] text-slate-steel font-mono tracking-[0.2em] uppercase">
            Workspace / schedules
          </div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.05] mt-1 text-snow">
            Cron
            <span className="text-emerald-signal">
              {" "}— {enabledSchedules.length} active, {headerNextLabel}
            </span>
          </h1>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 text-[12px] font-mono tracking-wider text-emerald-signal bg-carbon border border-emerald-signal rounded hover:bg-emerald-dim transition-colors"
          style={{ boxShadow: "0 0 12px rgba(0,217,146,0.2)" }}
        >
          {showForm ? "CANCEL" : "+ NEW SCHEDULE ⏎"}
        </button>
      </div>

      {showForm && (
        <div className="bg-carbon border border-charcoal rounded-lg p-4 mb-4 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Schedule name (e.g. AI Daily Digest)"
            className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow"
          />
          <textarea
            value={form.goal}
            onChange={(e) => setForm({ ...form, goal: e.target.value })}
            placeholder="Goal template — supports {date}, {yesterday}, {weekStart}, {weekEnd}"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow resize-none"
          />
          <input
            value={form.context}
            onChange={(e) => setForm({ ...form, context: e.target.value })}
            placeholder="Context (optional)"
            className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow"
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-slate-steel block mb-1">Cron expression</label>
              <input
                value={form.cron}
                onChange={(e) => setForm({ ...form, cron: e.target.value })}
                placeholder="0 9 * * *"
                className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow font-mono"
              />
            </div>
            <div className="w-28">
              <label className="text-[11px] text-slate-steel block mb-1">Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="w-full px-2 py-2 text-sm bg-abyss border border-charcoal rounded text-snow"
              >
                <option value="quick">Quick</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-steel block mb-1">
              Discord webhook (optional)
            </label>
            <input
              value={form.discordWebhook}
              onChange={(e) => setForm({ ...form, discordWebhook: e.target.value })}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow font-mono"
            />
          </div>
          <div className="text-[11px] text-slate-steel">
            Date variables: <code className="text-parchment">{"{date}"}</code>{" "}
            <code className="text-parchment">{"{yesterday}"}</code>{" "}
            <code className="text-parchment">{"{weekStart}"}</code>{" "}
            <code className="text-parchment">{"{weekEnd}"}</code>{" "}
            <code className="text-parchment">{"{monthStart}"}</code>{" "}
            <code className="text-parchment">{"{monthEnd}"}</code>{" "}
            <code className="text-parchment">{"{month}"}</code>{" "}
            <code className="text-parchment">{"{year}"}</code>
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm font-medium bg-emerald-signal/10 text-emerald-signal border border-emerald-signal/20 rounded hover:bg-emerald-signal/20 transition-colors"
          >
            Create schedule
          </button>
        </div>
      )}

      {/* 24-hour timeline */}
      {enabledSchedules.length > 0 && (
        <DayTimeline schedules={enabledSchedules} nextUpId={nextUp?.id ?? null} />
      )}

      {/* Cards grid */}
      {schedules.length === 0 && !showForm ? (
        <div className="text-sm text-slate-steel py-8 text-center">
          No schedules yet. Create one to auto-run research tasks on a cron and deliver to Discord.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              isNext={nextUp?.id === s.id}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
              triggering={triggering === s.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DayTimeline({
  schedules,
  nextUpId,
}: {
  schedules: ScheduleItem[];
  nextUpId: string | null;
}) {
  const now = new Date();
  const todayMs = now.getHours() * HOUR_MS + now.getMinutes() * MIN_MS;
  const dayLength = 24 * HOUR_MS;
  const dateLabel = now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Lay schedules onto rows, one row per schedule, in original order
  const rows = schedules.map((s, i) => ({
    schedule: s,
    triggers: cronTodayTriggers(s.cron),
    rowIdx: i,
  }));

  const rowHeight = 26;
  const totalRows = Math.max(rows.length, 1);
  const innerH = totalRows * rowHeight + 6;

  return (
    <div className="px-[22px] py-[18px] border border-charcoal rounded-lg bg-carbon mb-5 relative">
      <div className="flex items-center gap-2.5 mb-3.5">
        <span className="text-[10px] text-slate-steel font-mono tracking-[0.22em] uppercase">
          Today · {dateLabel}
        </span>
        <div className="flex-1 h-px bg-charcoal" />
        <span className="text-[10px] text-emerald-signal font-mono">◉ now · {timeLabel}</span>
      </div>

      <div className="relative" style={{ height: innerH + 22 }}>
        {/* Hour grid */}
        {Array.from({ length: 25 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 w-px"
            style={{
              left: `${(i / 24) * 100}%`,
              bottom: 22,
              background: i % 6 === 0 ? "var(--color-charcoal-light)" : "var(--color-charcoal)",
              opacity: i % 6 === 0 ? 0.8 : 0.4,
            }}
          />
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <div
            key={h}
            className="absolute bottom-0 text-[10px] font-mono text-slate-steel"
            style={{
              left: `${(h / 24) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {String(h).padStart(2, "0")}:00
          </div>
        ))}

        {/* Now line */}
        <div
          className="absolute top-0 w-0.5 bg-emerald-signal"
          style={{
            left: `${(todayMs / dayLength) * 100}%`,
            bottom: 22,
            boxShadow: "0 0 8px var(--color-emerald-signal)",
          }}
        />

        {/* Schedule bars */}
        {rows.map((row) =>
          row.triggers.map((t, ti) => {
            const isPast = t < todayMs;
            const isNext = nextUpId === row.schedule.id && !isPast;
            return (
              <div
                key={`${row.schedule.id}-${ti}`}
                className="absolute rounded text-[10px] flex items-center px-1.5 whitespace-nowrap overflow-hidden"
                style={{
                  top: row.rowIdx * rowHeight + 2,
                  left: `${(t / dayLength) * 100}%`,
                  width: 8,
                  height: rowHeight - 4,
                  background: isNext
                    ? "var(--color-emerald-signal)"
                    : isPast
                      ? "color-mix(in srgb, var(--color-emerald-signal) 30%, transparent)"
                      : "color-mix(in srgb, var(--color-emerald-signal) 50%, transparent)",
                  border: `1px solid var(--color-emerald-signal)`,
                  boxShadow: isNext ? "0 0 10px var(--color-emerald-signal)" : "none",
                }}
                title={`${row.schedule.name} · ${describeCron(row.schedule.cron)}`}
              >
                {isPast && <span className="text-[8px] text-emerald-signal">✓</span>}
              </div>
            );
          }),
        )}

        {/* Schedule label, anchored at first trigger */}
        {rows.map((row) => {
          const firstT = row.triggers[0];
          if (firstT === undefined) return null;
          const left = (firstT / dayLength) * 100;
          return (
            <span
              key={`label-${row.schedule.id}`}
              className="absolute text-[10px] text-slate-steel font-mono truncate"
              style={{
                top: row.rowIdx * rowHeight + 6,
                left: `calc(${left}% + 14px)`,
                maxWidth: `${100 - left - 2}%`,
              }}
            >
              {row.schedule.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleCard({
  schedule,
  isNext,
  onToggle,
  onDelete,
  onTrigger,
  triggering,
}: {
  schedule: ScheduleItem;
  isNext: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  triggering: boolean;
}) {
  const next = useMemo(() => cronNextTrigger(schedule.cron), [schedule.cron]);
  const nextLabel = next ? formatDuration(next - Date.now()) : "—";
  const lastLabel = schedule.lastRunAt ? formatRelativeShort(schedule.lastRunAt) : "—";

  const paused = !schedule.enabled;
  const accent = isNext ? "border-emerald-signal/50" : "border-charcoal";
  const bg = isNext ? "bg-carbon-hover" : "bg-carbon";

  return (
    <div
      className={`relative px-5 py-[18px] rounded-lg ${bg} border ${accent} ${
        paused ? "opacity-55" : ""
      } ${isNext ? "border-l-2 border-l-emerald-signal" : ""}`}
    >
      <div className="absolute top-3 right-4">
        {isNext && (
          <span className="text-[9px] text-emerald-signal font-mono tracking-[0.2em]">
            ● NEXT UP
          </span>
        )}
        {paused && (
          <span className="text-[9px] text-slate-steel font-mono tracking-[0.2em]">⏸ PAUSED</span>
        )}
      </div>

      <div className="text-[10px] text-emerald-signal font-mono mb-1.5">#{schedule.mode}</div>
      <div className="text-[15px] font-medium text-snow tracking-[-0.01em] mb-2.5 pr-20">
        {schedule.name}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2 bg-abyss border border-charcoal rounded mb-3">
        <span className="text-[11px] text-emerald-signal font-mono tracking-[0.06em]">
          {schedule.cron}
        </span>
        <span className="text-slate-steel">·</span>
        <span className="text-[11px] text-parchment">{describeCron(schedule.cron)}</span>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <Stat label="NEXT IN" val={nextLabel} highlight={isNext} />
        <Stat label="MODE" val={schedule.mode} />
        <Stat label="STATUS" val={schedule.enabled ? "active" : "paused"} />
        <Stat label="LAST" val={lastLabel} />
      </div>

      <div className="mt-3 pt-2.5 border-t border-dashed border-charcoal flex items-center gap-2">
        <button
          onClick={() => onToggle(schedule.id, !schedule.enabled)}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            schedule.enabled ? "bg-emerald-signal/30" : "bg-charcoal"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
              schedule.enabled ? "left-[18px] bg-emerald-signal" : "left-0.5 bg-slate-steel"
            }`}
          />
        </button>
        {schedule.discordWebhook && (
          <span className="text-sm" title="Discord delivery">
            💬
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onTrigger(schedule.id)}
          disabled={triggering}
          className="px-2.5 py-1 text-[11px] text-parchment hover:text-emerald-signal border border-charcoal rounded hover:border-emerald-signal/30 disabled:opacity-50 transition-colors"
          title="Run now"
        >
          {triggering ? "…" : "▶ Run"}
        </button>
        <button
          onClick={() => onDelete(schedule.id)}
          className="text-slate-steel hover:text-danger text-sm transition-colors"
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  val,
  highlight,
}: {
  label: string;
  val: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] text-slate-steel font-mono tracking-[0.18em] mb-0.5">{label}</div>
      <div
        className={`text-[13px] font-mono font-medium ${
          highlight ? "text-emerald-signal" : "text-snow"
        }`}
      >
        {val}
      </div>
    </div>
  );
}

function formatRelativeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < HOUR_MS) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / HOUR_MS)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
