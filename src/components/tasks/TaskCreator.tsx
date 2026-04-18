import { useState } from "react";
import { useTaskStore } from "../../store/tasks";
import { ToolsetPicker } from "./ToolsetPicker";
import { TASK_MODE_META } from "../../types";
import type { TaskMode } from "../../types";

const MODES: TaskMode[] = ["quick", "standard", "deep"];
const LANGUAGES = [
  { value: "", label: "Auto" },
  { value: "Chinese (简体中文)", label: "中文" },
  { value: "English", label: "EN" },
  { value: "Japanese (日本語)", label: "JP" },
];

function getStoredLanguage(): string {
  try { return localStorage.getItem("hermes-language") ?? ""; } catch { return ""; }
}
function storeLanguage(v: string) {
  try { localStorage.setItem("hermes-language", v); } catch { /* */ }
}

export function TaskCreator() {
  const dispatch = useTaskStore((s) => s.dispatch);
  const connected = useTaskStore((s) => s.connected);
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [toolsets, setToolsets] = useState<string[]>([]);
  const [mode, setMode] = useState<TaskMode>("deep");
  const [language, setLanguageState] = useState(getStoredLanguage);
  const setLanguage = (v: string) => { setLanguageState(v); storeLanguage(v); };
  const [showContext, setShowContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim() || sending) return;

    setSending(true);
    setError(null);
    try {
      await dispatch(goal.trim(), context.trim(), toolsets, mode, language || undefined);
      setGoal("");
      setContext("");
      setToolsets([]);
      setShowContext(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispatch");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-carbon border border-charcoal rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-emerald-signal text-sm">▶</span>
        <h2 className="text-sm font-semibold text-snow">New Task</h2>
      </div>

      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Describe the task for the subagent..."
        rows={3}
        className="w-full bg-abyss border border-charcoal rounded-md px-3 py-2.5 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50 resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleSubmit(e);
          }
        }}
      />

      {!showContext && (
        <button
          type="button"
          onClick={() => setShowContext(true)}
          className="mt-2 text-xs text-slate-steel hover:text-parchment transition-colors"
        >
          + Add context
        </button>
      )}

      {showContext && (
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Additional context, constraints, or reference material..."
          rows={2}
          className="mt-2 w-full bg-abyss border border-charcoal rounded-md px-3 py-2.5 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50 resize-none"
        />
      )}

      {/* Mode selector */}
      <div className="mt-3">
        <div className="text-xs text-slate-steel mb-2">Mode</div>
        <div className="flex gap-2">
          {MODES.map((m) => {
            const meta = TASK_MODE_META[m];
            const active = mode === m;
            return (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-2 rounded-md border text-left transition-colors ${
                  active
                    ? "border-emerald-signal/50 bg-emerald-dim"
                    : "border-charcoal bg-carbon hover:border-charcoal-light"
                }`}
              >
                <div
                  className={`text-xs font-semibold ${active ? "text-emerald-signal" : "text-snow"}`}
                >
                  {meta.label}
                </div>
                <div className="text-[10px] text-slate-steel mt-0.5 leading-snug">
                  {meta.description}
                </div>
                <div className="text-[10px] font-mono text-slate-steel/60 mt-0.5">
                  {meta.estimatedCalls}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Language */}
      <div className="mt-3 flex items-center gap-2">
        <div className="text-xs text-slate-steel">Language</div>
        <div className="flex gap-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setLanguage(l.value)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                language === l.value
                  ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                  : "bg-carbon border-charcoal text-slate-steel hover:text-parchment hover:border-charcoal-light"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-slate-steel mb-2">Toolsets</div>
        <ToolsetPicker selected={toolsets} onChange={setToolsets} />
      </div>

      {error && (
        <div className="mt-3 bg-danger-dim border border-danger/20 rounded-md px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-slate-steel font-mono">
          {connected ? "Ctrl+Enter to dispatch" : "Not connected"}
        </span>
        <button
          type="submit"
          disabled={!goal.trim() || sending || !connected}
          className="px-4 py-2 bg-carbon border border-charcoal rounded-md text-sm font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Dispatching..." : "Dispatch"}
        </button>
      </div>
    </form>
  );
}
