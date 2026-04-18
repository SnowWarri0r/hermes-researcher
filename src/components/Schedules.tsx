import { useState, useEffect } from "react";

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

export function Schedules() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", goal: "", context: "", mode: "deep", language: "", cron: "0 9 * * *", discordWebhook: "" });
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => { reload(); }, []);

  function reload() {
    fetch(`${API}/schedules`).then((r) => r.json()).then(setSchedules).catch(() => {});
  }

  async function handleCreate() {
    if (!form.name || !form.goal || !form.cron) return;
    await fetch(`${API}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, toolsets: [], enabled: true }),
    });
    setForm({ name: "", goal: "", context: "", mode: "deep", language: "", cron: "0 9 * * *", discordWebhook: "" });
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
    } catch { /* ignore */ }
    setTriggering(null);
    reload();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-snow">Schedules</h2>
        <button onClick={() => setShowForm((s) => !s)} className="px-3 py-1.5 text-xs font-medium bg-emerald-signal/10 text-emerald-signal border border-emerald-signal/20 rounded hover:bg-emerald-signal/20 transition-colors">
          {showForm ? "Cancel" : "+ New schedule"}
        </button>
      </div>

      {showForm && (
        <div className="bg-carbon border border-charcoal rounded-lg p-4 mb-4 space-y-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Schedule name (e.g. AI Daily Digest)" className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow" />
          <textarea value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Goal template — supports {date}, {yesterday}, {weekStart}, {weekEnd}" rows={3} className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow resize-none" />
          <input value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} placeholder="Context (optional)" className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow" />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-slate-steel block mb-1">Cron expression</label>
              <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 9 * * *" className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow font-mono" />
            </div>
            <div className="w-28">
              <label className="text-[11px] text-slate-steel block mb-1">Mode</label>
              <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="w-full px-2 py-2 text-sm bg-abyss border border-charcoal rounded text-snow">
                <option value="quick">Quick</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-steel block mb-1">Discord webhook (optional)</label>
            <input value={form.discordWebhook} onChange={(e) => setForm({ ...form, discordWebhook: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="w-full px-3 py-2 text-sm bg-abyss border border-charcoal rounded text-snow font-mono" />
          </div>
          <div className="text-[11px] text-slate-steel">
            Date variables: <code className="text-parchment">{"{date}"}</code> <code className="text-parchment">{"{yesterday}"}</code> <code className="text-parchment">{"{weekStart}"}</code> <code className="text-parchment">{"{weekEnd}"}</code> <code className="text-parchment">{"{monthStart}"}</code> <code className="text-parchment">{"{monthEnd}"}</code> <code className="text-parchment">{"{month}"}</code> <code className="text-parchment">{"{year}"}</code>
          </div>
          <div className="text-[11px] text-slate-steel">
            Cron: <code className="text-parchment">minute hour day month weekday</code> &mdash; e.g. <code className="text-parchment">0 9 * * *</code> = daily 9am, <code className="text-parchment">0 9 * * 1</code> = every Monday 9am
          </div>
          <button onClick={handleCreate} className="px-4 py-2 text-sm font-medium bg-emerald-signal/10 text-emerald-signal border border-emerald-signal/20 rounded hover:bg-emerald-signal/20 transition-colors">
            Create schedule
          </button>
        </div>
      )}

      <div className="space-y-2">
        {schedules.length === 0 && !showForm && (
          <div className="text-sm text-slate-steel py-8 text-center">
            No schedules yet. Create one to auto-run research tasks on a cron and deliver to Discord.
          </div>
        )}
        {schedules.map((s) => (
          <div key={s.id} className="bg-carbon border border-charcoal rounded-lg px-4 py-3 hover:border-charcoal-light transition-colors">
            <div className="flex items-center gap-3">
              <button onClick={() => handleToggle(s.id, !s.enabled)} className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${s.enabled ? "bg-emerald-signal/30" : "bg-charcoal"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${s.enabled ? "left-[18px] bg-emerald-signal" : "left-0.5 bg-slate-steel"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-snow font-medium">{s.name}</div>
                <div className="text-[12px] text-parchment mt-0.5 line-clamp-1">{s.goal}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-slate-steel bg-abyss px-2 py-0.5 rounded">{s.cron}</span>
                <span className="text-[10px] font-mono text-slate-steel">{s.mode[0].toUpperCase()}</span>
                {s.discordWebhook && <span className="text-sm" title="Discord delivery">💬</span>}
                <button onClick={() => handleTrigger(s.id)} disabled={triggering === s.id} className="px-2 py-1 text-[11px] text-parchment hover:text-emerald-signal border border-charcoal rounded hover:border-emerald-signal/30 disabled:opacity-50 transition-colors" title="Run now">
                  {triggering === s.id ? "..." : "▶ Run"}
                </button>
                <button onClick={() => handleDelete(s.id)} className="text-slate-steel hover:text-danger text-sm transition-colors" title="Delete">✕</button>
              </div>
            </div>
            {s.lastRunAt && (
              <div className="mt-2 text-[11px] text-slate-steel">
                Last run: {new Date(s.lastRunAt).toLocaleString()}
                {s.lastTaskId && <span className="ml-2 text-parchment">→ {s.lastTaskId.slice(0, 20)}...</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
