import { useState, useEffect } from "react";
import type { TaskTemplate, TemplateVariable, TaskMode } from "../types";
import { TASK_MODE_META } from "../types";

const API = "/api";

export function Templates() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [mode, setMode] = useState<TaskMode>("deep");
  const [vars, setVars] = useState<TemplateVariable[]>([]);

  useEffect(() => {
    fetch(`${API}/templates`)
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});
  }, []);

  // Auto-detect {variables} in goal text
  useEffect(() => {
    const matches = goal.match(/\{(\w+)\}/g);
    if (!matches) {
      setVars([]);
      return;
    }
    const names = [...new Set(matches.map((m) => m.slice(1, -1)))];
    setVars((prev) =>
      names.map(
        (n) =>
          prev.find((v) => v.name === n) ?? {
            name: n,
            label: n.charAt(0).toUpperCase() + n.slice(1),
            type: "text" as const,
            placeholder: "",
          },
      ),
    );
  }, [goal]);

  function updateVar(name: string, patch: Partial<TemplateVariable>) {
    setVars((prev) => prev.map((v) => (v.name === name ? { ...v, ...patch } : v)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !goal.trim()) return;
    const res = await fetch(`${API}/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim(),
        goal: goal.trim(),
        context: context.trim(),
        toolsets: [],
        mode,
        language: "",
        variables: vars,
      }),
    });
    const tpl = await res.json();
    setTemplates([...templates, tpl]);
    setName("");
    setDescription("");
    setGoal("");
    setContext("");
    setVars([]);
    setShowForm(false);
  }

  async function handleDelete(id: string) {
    await fetch(`${API}/templates/${id}`, { method: "DELETE" });
    setTemplates(templates.filter((t) => t.id !== id));
  }

  const inputCls =
    "w-full bg-abyss border border-charcoal rounded-md px-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50";

  const totalVars = templates.reduce((s, t) => s + t.variables.length, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[11px] text-slate-steel font-mono tracking-[0.2em] uppercase">
            Workspace / templates
          </div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.05] mt-1 text-snow">
            {templates.length} template{templates.length === 1 ? "" : "s"}
            <span className="text-emerald-signal"> · {totalVars} variables</span>
          </h1>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 text-[12px] font-mono tracking-wider text-emerald-signal bg-carbon border border-emerald-signal rounded hover:bg-emerald-dim transition-colors"
          style={{ boxShadow: "0 0 12px rgba(0,217,146,0.2)" }}
        >
          {showForm ? "CANCEL" : "+ NEW TEMPLATE ⏎"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-carbon border border-charcoal rounded-lg p-4 space-y-3"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className={inputCls}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            className={`${inputCls} text-xs`}
          />
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal — use {variable} for placeholders, e.g. 'Competitive analysis of {product} in {market}'"
            rows={2}
            className={`${inputCls} resize-none`}
          />
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Default context (optional)"
            rows={2}
            className={`${inputCls} text-xs resize-none`}
          />

          {/* Auto-detected variables */}
          {vars.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-steel">Variables detected — configure each:</div>
              {vars.map((v) => (
                <div
                  key={v.name}
                  className="bg-abyss border border-charcoal-subtle rounded-md p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-mint shrink-0">{`{${v.name}}`}</span>
                    <input
                      value={v.label}
                      onChange={(e) => updateVar(v.name, { label: e.target.value })}
                      placeholder="Label"
                      className="flex-1 bg-carbon border border-charcoal rounded px-2 py-1 text-[11px] text-snow focus:outline-none focus:border-emerald-signal/50"
                    />
                    <select
                      value={v.type}
                      onChange={(e) =>
                        updateVar(v.name, {
                          type: e.target.value as TemplateVariable["type"],
                          options: e.target.value === "select" ? [""] : undefined,
                        })
                      }
                      className="bg-carbon border border-charcoal rounded px-2 py-1 text-[11px] text-snow focus:outline-none"
                    >
                      <option value="text">Text</option>
                      <option value="select">Select</option>
                      <option value="number">Number</option>
                    </select>
                  </div>
                  {v.type === "text" && (
                    <input
                      value={v.placeholder ?? ""}
                      onChange={(e) => updateVar(v.name, { placeholder: e.target.value })}
                      placeholder="Placeholder text"
                      className="w-full bg-carbon border border-charcoal rounded px-2 py-1 text-[11px] text-slate-steel focus:outline-none focus:border-emerald-signal/50"
                    />
                  )}
                  {v.type === "select" && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-steel">Options (one per line):</div>
                      <textarea
                        value={(v.options ?? []).join("\n")}
                        onChange={(e) =>
                          updateVar(v.name, { options: e.target.value.split("\n").filter(Boolean) })
                        }
                        rows={3}
                        className="w-full bg-carbon border border-charcoal rounded px-2 py-1 text-[11px] text-snow resize-none focus:outline-none focus:border-emerald-signal/50"
                        placeholder="Python\nGo\nRust"
                      />
                    </div>
                  )}
                  <input
                    value={v.defaultValue ?? ""}
                    onChange={(e) => updateVar(v.name, { defaultValue: e.target.value })}
                    placeholder="Default value"
                    className="w-full bg-carbon border border-charcoal rounded px-2 py-1 text-[11px] text-slate-steel focus:outline-none focus:border-emerald-signal/50"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-steel">Mode:</span>
            {(["quick", "standard", "deep"] as TaskMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  mode === m
                    ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                    : "bg-carbon border-charcoal text-slate-steel"
                }`}
              >
                {TASK_MODE_META[m].label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!name.trim() || !goal.trim()}
            className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors"
          >
            Create
          </button>
        </form>
      )}

      {/* Empty state */}
      {templates.length === 0 && !showForm && (
        <div className="text-sm text-slate-steel/60 text-center py-12">
          No templates yet. Create one to reuse goal+context+mode presets in the task composer.
        </div>
      )}

      {/* Cards grid */}
      {templates.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="group relative bg-carbon border border-charcoal hover:border-charcoal-light rounded-lg px-[18px] py-4 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-signal font-mono tracking-[0.18em] uppercase">
                      {tpl.mode}
                    </span>
                    {tpl.variables.length > 0 && (
                      <span className="text-[10px] text-slate-steel font-mono">
                        · {tpl.variables.length} var
                        {tpl.variables.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="text-[15px] font-medium text-snow tracking-[-0.005em] mt-1">
                    {tpl.name}
                  </div>
                  {tpl.description && (
                    <div className="text-[12px] text-slate-steel mt-1">{tpl.description}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(tpl.id)}
                  className="text-slate-steel/60 hover:text-danger text-xs p-1 -mt-1 -mr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 px-3 py-2 bg-abyss border border-charcoal-subtle rounded text-[12px] text-parchment font-mono leading-relaxed whitespace-pre-wrap break-words line-clamp-3">
                {tpl.goal}
              </div>

              {tpl.variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {tpl.variables.map((v) => (
                    <span
                      key={v.name}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-info-dim text-info border border-info/20 font-mono"
                      title={`type: ${v.type}${v.defaultValue ? ` · default: ${v.defaultValue}` : ""}`}
                    >
                      {v.type === "select" ? `{${v.name}} ▾` : `{${v.name}}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
