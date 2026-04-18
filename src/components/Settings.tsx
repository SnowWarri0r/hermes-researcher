import { useState } from "react";
import { useTaskStore } from "../store/tasks";
import { checkHealth } from "../api/client";

export function Settings() {
  const connected = useTaskStore((s) => s.connected);
  const setConnected = useTaskStore((s) => s.setConnected);
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    const ok = await checkHealth();
    setConnected(ok);
    setTesting(false);
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold text-snow mb-6 font-[family-name:var(--font-heading)] tracking-tight">
        Connection
      </h2>

      <div className="bg-carbon border border-charcoal rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-medium text-snow">Backend</div>
            <div className="text-xs text-slate-steel mt-0.5 font-mono">
              http://127.0.0.1:8787
            </div>
          </div>
          <span
            className={`text-xs font-medium ${connected ? "text-success" : "text-danger"}`}
          >
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

      <div className="mt-6 bg-abyss border border-charcoal rounded-lg p-4">
        <div className="text-xs font-medium text-slate-steel mb-2 uppercase tracking-wider">
          How it works
        </div>
        <div className="text-[12px] text-parchment space-y-2 leading-relaxed">
          <p>
            This dashboard talks to a local middleware at port <span className="font-mono text-mint">8787</span> which
            persists all tasks to <span className="font-mono text-mint">~/.hermes-dashboard/tasks.db</span>.
          </p>
          <p>
            The middleware proxies to the Hermes API server at <span className="font-mono text-mint">127.0.0.1:8642</span> using{" "}
            <span className="font-mono text-mint">HERMES_API_KEY</span> from its environment.
          </p>
        </div>
      </div>

      <div className="mt-6 bg-abyss border border-charcoal rounded-lg p-4">
        <div className="text-xs font-medium text-slate-steel mb-2 uppercase tracking-wider">
          Start middleware
        </div>
        <pre className="text-[11px] text-parchment font-mono bg-carbon px-3 py-2 rounded-md border border-charcoal-subtle overflow-x-auto">
{`cd server
HERMES_API_KEY=... pnpm dev`}
        </pre>
      </div>
    </div>
  );
}
