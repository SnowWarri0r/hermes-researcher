import { useState, useEffect } from "react";
import { useTaskStore } from "../store/tasks";
import { checkHealth } from "../api/client";
import type { ModelRouting, TaskTemplate, TemplateVariable, TaskMode, EmbeddingSettings, EmbeddingProvider } from "../types";
import { TASK_MODE_META } from "../types";

const API = "/api";

const PHASE_LABELS: { key: keyof ModelRouting; label: string; hint: string }[] = [
  { key: "plan", label: "Plan", hint: "Cheap/fast — text only, no tools" },
  { key: "research", label: "Research", hint: "Strong — needs web/browser tools" },
  { key: "draft", label: "Draft", hint: "Strong — synthesizes findings" },
  { key: "critique", label: "Critique", hint: "Cheap/fast — text review only" },
  { key: "revise", label: "Revise", hint: "Strong — final output quality" },
];

export function Settings() {
  const connected = useTaskStore((s) => s.connected);
  const setConnected = useTaskStore((s) => s.setConnected);

  return (
    <div className="max-w-2xl space-y-8">
      <ConnectionSection connected={connected} setConnected={setConnected} />
      <EmbeddingSection />
      <PipelineSection />
      <ModelRoutingSection />
      <TemplatesSection />
    </div>
  );
}

function ConnectionSection({
  connected,
  setConnected,
}: {
  connected: boolean;
  setConnected: (c: boolean) => void;
}) {
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    const ok = await checkHealth();
    setConnected(ok);
    setTesting(false);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-snow mb-4 font-[family-name:var(--font-heading)] tracking-tight">
        Connection
      </h2>
      <div className="bg-carbon border border-charcoal rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-medium text-snow">Backend</div>
            <div className="text-xs text-slate-steel mt-0.5 font-mono">
              http://127.0.0.1:8787 → hermes:8642
            </div>
          </div>
          <span className={`text-xs font-medium ${connected ? "text-success" : "text-danger"}`}>
            {connected ? "● connected" : "○ offline"}
          </span>
        </div>
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-4 py-2 bg-abyss border border-charcoal rounded-md text-sm text-parchment hover:border-charcoal-light disabled:opacity-40 transition-colors"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
    </div>
  );
}

const PROVIDER_PRESETS: Record<EmbeddingProvider, { endpoint: string; model: string; dimensions: number; label: string }> = {
  openai: { endpoint: "https://api.openai.com", model: "text-embedding-3-small", dimensions: 1536, label: "OpenAI" },
  volcengine: { endpoint: "https://ark.cn-beijing.volces.com", model: "", dimensions: 2048, label: "Volcengine (Doubao)" },
  ollama: { endpoint: "http://localhost:11434", model: "nomic-embed-text", dimensions: 768, label: "Ollama (local)" },
};

function EmbeddingSection() {
  const [config, setConfig] = useState<EmbeddingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((d) => setConfig(d.embedding ?? { provider: "openai", endpoint: "", apiKey: "", model: "", dimensions: 0 }))
      .catch(() => {});
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    await fetch(`${API}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedding: config }),
    });
    setSaving(false);
  }

  async function testConnection() {
    setTestResult("Testing...");
    try {
      if (!config?.endpoint || !config?.apiKey) {
        setTestResult("Endpoint and API key required");
        return;
      }
      const base = config.endpoint.replace(/\/$/, "");
      const url = base.endsWith("/v1") ? `${base}/embeddings` : `${base}/v1/embeddings`;
      const res = await fetch("/api/test-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, apiKey: config.apiKey, model: config.model }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult(`Connected — returned ${data.dimensions}-dim vector`);
      } else {
        setTestResult(`Failed: ${data.error}`);
      }
    } catch (e) {
      setTestResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!config) return null;

  const inputCls = "flex-1 bg-abyss border border-charcoal rounded-md px-3 py-1.5 text-xs text-snow placeholder:text-slate-steel/50 font-mono focus:outline-none focus:border-emerald-signal/50";

  return (
    <div>
      <h2 className="text-lg font-semibold text-snow mb-4 font-[family-name:var(--font-heading)] tracking-tight">
        Embedding
      </h2>
      <div className="bg-carbon border border-charcoal rounded-lg p-5 space-y-3">
        <div className="text-xs text-slate-steel mb-1">
          Required for semantic knowledge recall. Select a provider, fill in credentials, then Test.
        </div>

        {/* Provider tabs */}
        <div className="flex gap-1.5">
          {(Object.keys(PROVIDER_PRESETS) as EmbeddingProvider[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                const preset = PROVIDER_PRESETS[p];
                setConfig({
                  ...config,
                  provider: p,
                  endpoint: config.endpoint || preset.endpoint,
                  model: config.model || preset.model,
                  dimensions: config.dimensions || preset.dimensions,
                });
              }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                config.provider === p
                  ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                  : "bg-abyss border-charcoal text-slate-steel hover:border-charcoal-light"
              }`}
            >
              {PROVIDER_PRESETS[p].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-xs font-medium text-snow">Endpoint</div>
          <input type="text" value={config.endpoint} onChange={(e) => setConfig({ ...config, endpoint: e.target.value })} placeholder={PROVIDER_PRESETS[config.provider].endpoint} className={inputCls} />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-xs font-medium text-snow">API Key</div>
          <input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} placeholder={config.provider === "ollama" ? "(not required)" : "sk-... or API key"} className={inputCls} />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-xs font-medium text-snow">Model</div>
          <input type="text" value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} placeholder={PROVIDER_PRESETS[config.provider].model || "model-id"} className={inputCls} />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-xs font-medium text-snow">Dimensions</div>
          <input type="number" value={config.dimensions || ""} onChange={(e) => setConfig({ ...config, dimensions: Number(e.target.value) || 0 })} placeholder={String(PROVIDER_PRESETS[config.provider].dimensions)} className={`${inputCls} w-24 flex-none`} />
          <span className="text-[10px] text-slate-steel">0 = default ({PROVIDER_PRESETS[config.provider].dimensions})</span>
        </div>

        {config.provider === "volcengine" && (
          <div className="text-[10px] text-slate-steel/60 bg-abyss rounded px-3 py-2 border border-charcoal-subtle">
            Direct Volcengine Doubao API — no proxy needed. Get your model endpoint ID from the Volcengine console (e.g. <span className="text-mint font-mono">ep-xxxx</span>).
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} disabled={saving} className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors">
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={testConnection} className="px-4 py-1.5 bg-abyss border border-charcoal rounded-md text-xs text-parchment hover:border-charcoal-light transition-colors">
            Test
          </button>
          {testResult && (
            <span className={`text-[11px] ${testResult.startsWith("Connected") ? "text-success" : "text-danger"}`}>
              {testResult}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineSection() {
  const [maxResearch, setMaxResearch] = useState(5);
  const [maxRuns, setMaxRuns] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`).then((r) => r.json()).then((d) => setMaxResearch(d.maxParallelResearch ?? 5)).catch(() => {});
    fetch(`${API}/gateway`).then((r) => r.json()).then((d) => setMaxRuns(d.maxConcurrentRuns ?? 10)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch(`${API}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxParallelResearch: maxResearch }) });
      await fetch(`${API}/gateway`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxConcurrentRuns: maxRuns }) });
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-snow mb-3">Pipeline</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-xs text-parchment w-48">Max parallel research</label>
          <input type="number" min={1} max={10} value={maxResearch} onChange={(e) => setMaxResearch(Number(e.target.value) || 1)}
            className="w-20 px-2 py-1 text-xs bg-abyss border border-charcoal rounded text-snow text-center" />
          <span className="text-[10px] text-slate-steel">branches per task</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-parchment w-48">Hermes max concurrent runs</label>
          <input type="number" min={1} max={100} value={maxRuns} onChange={(e) => setMaxRuns(Number(e.target.value) || 1)}
            className="w-20 px-2 py-1 text-xs bg-abyss border border-charcoal rounded text-snow text-center" />
          <span className="text-[10px] text-slate-steel">gateway limit (restarts gateway)</span>
        </div>
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 text-xs font-medium bg-emerald-signal/10 text-emerald-signal border border-emerald-signal/20 rounded hover:bg-emerald-signal/20 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function ModelRoutingSection() {
  const [routing, setRouting] = useState<ModelRouting | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((d) => setRouting(d.modelRouting))
      .catch(() => {});
  }, []);

  async function save() {
    if (!routing) return;
    setSaving(true);
    await fetch(`${API}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelRouting: routing }),
    });
    setSaving(false);
  }

  if (!routing) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-snow mb-4 font-[family-name:var(--font-heading)] tracking-tight">
        Model Routing
      </h2>
      <div className="bg-carbon border border-charcoal rounded-lg p-5 space-y-3">
        <div className="text-xs text-slate-steel mb-2">
          Leave empty to use hermes default model. Use model IDs like <span className="font-mono text-mint">google/gemini-2.5-flash</span> for cheap phases.
        </div>
        {PHASE_LABELS.map((p) => (
          <div key={String(p.key)} className="flex items-center gap-3">
            <div className="w-20 shrink-0">
              <div className="text-xs font-medium text-snow">{p.label}</div>
              <div className="text-[10px] text-slate-steel">{p.hint}</div>
            </div>
            <input
              type="text"
              value={routing[p.key]}
              onChange={(e) =>
                setRouting({ ...routing, [p.key]: e.target.value })
              }
              placeholder="hermes default"
              className="flex-1 bg-abyss border border-charcoal rounded-md px-3 py-1.5 text-xs text-snow placeholder:text-slate-steel/50 font-mono focus:outline-none focus:border-emerald-signal/50"
            />
          </div>
        ))}
        <button
          onClick={save}
          disabled={saving}
          className="mt-2 px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function TemplatesSection() {
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
    if (!matches) { setVars([]); return; }
    const names = [...new Set(matches.map((m) => m.slice(1, -1)))];
    setVars((prev) =>
      names.map((n) => prev.find((v) => v.name === n) ?? {
        name: n,
        label: n.charAt(0).toUpperCase() + n.slice(1),
        type: "text" as const,
        placeholder: "",
      })
    );
  }, [goal]);

  function updateVar(name: string, patch: Partial<TemplateVariable>) {
    setVars((prev) =>
      prev.map((v) => (v.name === name ? { ...v, ...patch } : v))
    );
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
    setName(""); setDescription(""); setGoal(""); setContext(""); setVars([]);
    setShowForm(false);
  }

  async function handleDelete(id: string) {
    await fetch(`${API}/templates/${id}`, { method: "DELETE" });
    setTemplates(templates.filter((t) => t.id !== id));
  }

  const inputCls = "w-full bg-abyss border border-charcoal rounded-md px-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-snow font-[family-name:var(--font-heading)] tracking-tight">Templates</h2>
        <button onClick={() => setShowForm(!showForm)} className="text-xs text-mint hover:text-emerald-signal transition-colors">
          {showForm ? "Cancel" : "+ New template"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-carbon border border-charcoal rounded-lg p-4 mb-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className={inputCls} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className={`${inputCls} text-xs`} />
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal — use {variable} for placeholders, e.g. 'Competitive analysis of {product} in {market}'"
            rows={2}
            className={`${inputCls} resize-none`}
          />
          <textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder="Default context (optional)" rows={2} className={`${inputCls} text-xs resize-none`} />

          {/* Auto-detected variables */}
          {vars.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-steel">Variables detected — configure each:</div>
              {vars.map((v) => (
                <div key={v.name} className="bg-abyss border border-charcoal-subtle rounded-md p-3 space-y-2">
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
                      onChange={(e) => updateVar(v.name, { type: e.target.value as TemplateVariable["type"], options: e.target.value === "select" ? [""] : undefined })}
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
                        onChange={(e) => updateVar(v.name, { options: e.target.value.split("\n").filter(Boolean) })}
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
              <button key={m} type="button" onClick={() => setMode(m)} className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${mode === m ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal" : "bg-carbon border-charcoal text-slate-steel"}`}>
                {TASK_MODE_META[m].label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!name.trim() || !goal.trim()} className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors">Create</button>
        </form>
      )}

      {templates.length === 0 && !showForm && (
        <div className="text-xs text-slate-steel/60 text-center py-6">No templates yet.</div>
      )}

      <div className="space-y-2">
        {templates.map((tpl) => (
          <div key={tpl.id} className="bg-carbon border border-charcoal rounded-lg px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-snow">{tpl.name}</div>
              {tpl.description && <div className="text-xs text-slate-steel mt-0.5">{tpl.description}</div>}
              <div className="text-[11px] text-parchment font-mono mt-1 truncate">{tpl.goal}</div>
              {tpl.variables.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {tpl.variables.map((v) => (
                    <span key={v.name} className="text-[10px] px-1.5 py-0.5 rounded bg-info-dim text-info border border-info/20 font-mono">
                      {v.type === "select" ? `{${v.name}} ▾` : `{${v.name}}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => handleDelete(tpl.id)} className="text-slate-steel hover:text-danger text-xs shrink-0">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

