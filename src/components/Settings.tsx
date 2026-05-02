import { useState, useEffect } from "react";
import { useTaskStore } from "../store/tasks";
import { checkHealth } from "../api/client";
import type { ModelRouting, EmbeddingSettings, EmbeddingProvider } from "../types";

const API = "/api";

const PHASE_LABELS: { key: keyof ModelRouting; label: string; hint: string }[] = [
  { key: "plan", label: "Plan", hint: "Cheap/fast — text only, no tools" },
  { key: "research", label: "Research", hint: "Strong — needs web/browser tools" },
  { key: "draft", label: "Draft", hint: "Strong — synthesizes findings" },
  { key: "critique", label: "Critique", hint: "Cheap/fast — text review only" },
  { key: "revise", label: "Revise", hint: "Strong — final output quality" },
];

type SectionKey = "general" | "models" | "embedding" | "pipeline";

const SECTIONS: { key: SectionKey; code: string; label: string }[] = [
  { key: "general", code: "GENERAL", label: "Connection" },
  { key: "models", code: "MODEL", label: "Models & routing" },
  { key: "embedding", code: "STORE", label: "Embedding & vector" },
  { key: "pipeline", code: "PIPELINE", label: "Pipeline limits" },
];

export function Settings() {
  const connected = useTaskStore((s) => s.connected);
  const setConnected = useTaskStore((s) => s.setConnected);
  const [active, setActive] = useState<SectionKey>("general");
  const activeMeta = SECTIONS.find((s) => s.key === active)!;

  return (
    <div className="flex-1 grid grid-cols-[260px_1fr] overflow-hidden relative z-[1]">
      {/* Left rail */}
      <aside className="border-r border-charcoal bg-carbon px-4 py-5 overflow-y-auto relative z-[2]">
        <div className="text-[11px] text-slate-steel font-mono tracking-[0.22em] mb-4 px-2">
          SETTINGS
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => {
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] border-l-2 transition-colors ${
                  isActive
                    ? "bg-emerald-dim text-emerald-signal border-emerald-signal font-semibold"
                    : "text-parchment hover:bg-carbon-hover border-transparent"
                }`}
              >
                <span
                  className={`text-[10px] font-mono tracking-[0.1em] w-[72px] shrink-0 ${
                    isActive ? "text-emerald-signal" : "text-slate-steel"
                  }`}
                >
                  {s.code}
                </span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <main className="overflow-y-auto px-10 py-7">
        <div className="max-w-5xl">
          <div className="text-[11px] text-slate-steel font-mono tracking-[0.22em] uppercase mb-1.5">
            Settings / {activeMeta.code}
          </div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.05] text-snow mb-6">
            {activeMeta.label}
          </h1>

          {active === "general" && (
            <ConnectionSection connected={connected} setConnected={setConnected} />
          )}
          {active === "models" && <ModelRoutingSection />}
          {active === "embedding" && <EmbeddingSection />}
          {active === "pipeline" && <PipelineSection />}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection / Gateway strip
// ---------------------------------------------------------------------------
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
    <div className="space-y-5">
      <div
        className="px-5 py-4 border border-charcoal rounded-lg bg-carbon flex items-center gap-6"
        style={{ boxShadow: "inset 0 0 0 1px rgba(0,217,146,0.04)" }}
      >
        <div>
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.2em]">
            LLM GATEWAY
          </div>
          <div className="text-[16px] text-snow font-mono mt-1">
            http://127.0.0.1:<span className="text-emerald-signal">8787</span>
          </div>
        </div>
        <div className="w-px h-9 bg-charcoal" />
        <div>
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.2em]">STATUS</div>
          <div
            className={`text-[13px] font-mono mt-1 flex items-center gap-1.5 ${
              connected ? "text-emerald-signal" : "text-danger"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? "bg-emerald-signal" : "bg-danger/70"
              }`}
              style={connected ? { boxShadow: "0 0 6px var(--color-emerald-signal)" } : undefined}
            />
            {connected ? "online" : "offline"}
          </div>
        </div>
        <div className="w-px h-9 bg-charcoal" />
        <div>
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.2em]">UPSTREAM</div>
          <div className="text-[13px] text-parchment font-mono mt-1">hermes:8642</div>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-3 py-1.5 bg-carbon border border-charcoal text-slate-steel hover:text-parchment hover:border-charcoal-light rounded text-[11px] font-mono tracking-wider disabled:opacity-40 transition-colors"
        >
          {testing ? "TESTING…" : "TEST CONNECTION"}
        </button>
      </div>

      <div className="text-[12px] text-slate-steel leading-relaxed">
        The dashboard server proxies pipeline runs to the Hermes Agent gateway. Status reflects the
        last health check; click test to refresh manually.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models & routing — gateway strip + role table
// ---------------------------------------------------------------------------
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

  if (!routing) return <div className="text-sm text-slate-steel">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="text-[12px] text-slate-steel leading-relaxed">
        Route each pipeline phase to the right model. Leave empty to use the Hermes default. Use
        the gateway-recognized model ID, e.g.{" "}
        <span className="text-mint font-mono">google/gemini-2.5-flash</span>.
      </div>

      <div className="border border-charcoal rounded-lg overflow-hidden">
        {/* Header row */}
        <div
          className="px-5 py-2.5 bg-carbon border-b border-charcoal grid items-center gap-4 text-[10px] text-slate-steel font-mono tracking-[0.18em]"
          style={{ gridTemplateColumns: "120px 1fr 200px" }}
        >
          <span>ROLE</span>
          <span>PRIMARY MODEL</span>
          <span>HINT</span>
        </div>

        {PHASE_LABELS.map((p, i) => (
          <div
            key={String(p.key)}
            className={`px-5 py-3.5 grid items-center gap-4 text-[13px] ${
              i === 0 ? "bg-carbon-hover" : "bg-carbon"
            } ${i < PHASE_LABELS.length - 1 ? "border-b border-charcoal" : ""}`}
            style={{ gridTemplateColumns: "120px 1fr 200px" }}
          >
            <span className="text-[10px] text-emerald-signal font-mono tracking-[0.18em] uppercase">
              {p.label}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-signal shrink-0"
                style={{ boxShadow: "0 0 6px var(--color-emerald-signal)" }}
              />
              <input
                type="text"
                value={routing[p.key]}
                onChange={(e) => setRouting({ ...routing, [p.key]: e.target.value })}
                placeholder="hermes default"
                className="flex-1 bg-abyss border border-charcoal rounded px-2.5 py-1.5 text-[12px] text-snow placeholder:text-slate-steel/50 font-mono focus:outline-none focus:border-emerald-signal/50"
              />
            </div>
            <span className="text-[11px] text-slate-steel font-mono">{p.hint}</span>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="px-4 py-2 bg-carbon border border-emerald-signal text-emerald-signal rounded text-[12px] font-mono tracking-wider hover:bg-emerald-dim disabled:opacity-40 transition-colors"
        style={{ boxShadow: "0 0 12px rgba(0,217,146,0.2)" }}
      >
        {saving ? "SAVING…" : "SAVE ROUTING ⏎"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embedding (vector store config)
// ---------------------------------------------------------------------------
const PROVIDER_PRESETS: Record<
  EmbeddingProvider,
  { endpoint: string; model: string; dimensions: number; label: string }
> = {
  openai: {
    endpoint: "https://api.openai.com",
    model: "text-embedding-3-small",
    dimensions: 1536,
    label: "OpenAI",
  },
  volcengine: {
    endpoint: "https://ark.cn-beijing.volces.com",
    model: "",
    dimensions: 2048,
    label: "Volcengine (Doubao)",
  },
  ollama: {
    endpoint: "http://localhost:11434",
    model: "nomic-embed-text",
    dimensions: 768,
    label: "Ollama (local)",
  },
};

function EmbeddingSection() {
  const [config, setConfig] = useState<EmbeddingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((d) =>
        setConfig(
          d.embedding ?? {
            provider: "openai",
            endpoint: "",
            apiKey: "",
            model: "",
            dimensions: 0,
          },
        ),
      )
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
    setTestResult("Testing…");
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

  if (!config) return <div className="text-sm text-slate-steel">Loading…</div>;

  const inputCls =
    "flex-1 bg-abyss border border-charcoal rounded-md px-3 py-1.5 text-xs text-snow placeholder:text-slate-steel/50 font-mono focus:outline-none focus:border-emerald-signal/50";

  return (
    <div className="space-y-5">
      <div className="text-[12px] text-slate-steel leading-relaxed">
        Required for semantic recall in the Knowledge index. Pick a provider, fill credentials,
        then test before saving.
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

      <div className="bg-carbon border border-charcoal rounded-lg p-5 space-y-3">
        <Field label="Endpoint">
          <input
            type="text"
            value={config.endpoint}
            onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
            placeholder={PROVIDER_PRESETS[config.provider].endpoint}
            className={inputCls}
          />
        </Field>
        <Field label="API key">
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder={
              config.provider === "ollama" ? "(not required)" : "sk-... or API key"
            }
            className={inputCls}
          />
        </Field>
        <Field label="Model">
          <input
            type="text"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder={PROVIDER_PRESETS[config.provider].model || "model-id"}
            className={inputCls}
          />
        </Field>
        <Field label="Dimensions">
          <input
            type="number"
            value={config.dimensions || ""}
            onChange={(e) =>
              setConfig({ ...config, dimensions: Number(e.target.value) || 0 })
            }
            placeholder={String(PROVIDER_PRESETS[config.provider].dimensions)}
            className={`${inputCls} w-24 flex-none`}
          />
          <span className="text-[10px] text-slate-steel">
            0 = default ({PROVIDER_PRESETS[config.provider].dimensions})
          </span>
        </Field>

        {config.provider === "volcengine" && (
          <div className="text-[10px] text-slate-steel/60 bg-abyss rounded px-3 py-2 border border-charcoal-subtle">
            Direct Volcengine Doubao API — no proxy needed. Get the model endpoint ID from the
            Volcengine console (e.g. <span className="text-mint font-mono">ep-xxxx</span>).
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={testConnection}
            className="px-4 py-1.5 bg-abyss border border-charcoal rounded-md text-xs text-parchment hover:border-charcoal-light transition-colors"
          >
            Test
          </button>
          {testResult && (
            <span
              className={`text-[11px] ${
                testResult.startsWith("Connected") ? "text-success" : "text-danger"
              }`}
            >
              {testResult}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 shrink-0 text-xs font-medium text-snow">{label}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline limits
// ---------------------------------------------------------------------------
function PipelineSection() {
  const [maxResearch, setMaxResearch] = useState(5);
  const [maxRuns, setMaxRuns] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((d) => setMaxResearch(d.maxParallelResearch ?? 5))
      .catch(() => {});
    fetch(`${API}/gateway`)
      .then((r) => r.json())
      .then((d) => setMaxRuns(d.maxConcurrentRuns ?? 10))
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxParallelResearch: maxResearch }),
      });
      await fetch(`${API}/gateway`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrentRuns: maxRuns }),
      });
    } catch {
      /* ignore */
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div className="text-[12px] text-slate-steel leading-relaxed">
        Concurrency and fan-out limits. Higher numbers run faster but burn more tokens; raising
        the gateway limit triggers a Hermes restart.
      </div>

      <div className="bg-carbon border border-charcoal rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-[13px] text-snow w-56">Max parallel research</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxResearch}
            onChange={(e) => setMaxResearch(Number(e.target.value) || 1)}
            className="w-20 px-2 py-1 text-sm bg-abyss border border-charcoal rounded text-snow text-center font-mono"
          />
          <span className="text-[11px] text-slate-steel">branches per task</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-[13px] text-snow w-56">Hermes max concurrent runs</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxRuns}
            onChange={(e) => setMaxRuns(Number(e.target.value) || 1)}
            className="w-20 px-2 py-1 text-sm bg-abyss border border-charcoal rounded text-snow text-center font-mono"
          />
          <span className="text-[11px] text-slate-steel">gateway limit (restarts gateway)</span>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-[12px] font-mono tracking-wider bg-carbon border border-emerald-signal text-emerald-signal rounded hover:bg-emerald-dim disabled:opacity-40 transition-colors"
          style={{ boxShadow: "0 0 12px rgba(0,217,146,0.2)" }}
        >
          {saving ? "SAVING…" : "SAVE ⏎"}
        </button>
      </div>
    </div>
  );
}
