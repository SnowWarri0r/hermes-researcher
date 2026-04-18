import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PhaseDetail, PhaseKind, PhaseStatus } from "../../types";

const PHASE_META: Record<
  PhaseKind,
  { label: string; icon: string; color: string }
> = {
  plan: { label: "Plan", icon: "◈", color: "text-info" },
  research: { label: "Research", icon: "⌕", color: "text-warning" },
  draft: { label: "Draft", icon: "✎", color: "text-parchment" },
  critique: { label: "Critique", icon: "⚖", color: "text-agent-thinking" },
  revise: { label: "Revise", icon: "✓", color: "text-emerald-signal" },
  write: { label: "Write", icon: "✎", color: "text-emerald-signal" },
};

function statusDot(status: PhaseStatus): string {
  switch (status) {
    case "running":
      return "bg-agent-active animate-pulse";
    case "completed":
      return "bg-success";
    case "failed":
      return "bg-danger";
    case "skipped":
      return "bg-slate-steel";
    default:
      return "bg-slate-steel/40";
  }
}

function formatDuration(phase: PhaseDetail): string | null {
  if (!phase.completedAt || !phase.createdAt) return null;
  return `${((phase.completedAt - phase.createdAt) / 1000).toFixed(1)}s`;
}

function toolCount(phase: PhaseDetail): number {
  return phase.toolCount ?? 0;
}

export function PipelineView({ phases }: { phases: PhaseDetail[] }) {
  // Group phases by seq (stage). Research stage (seq=1) has N branches.
  const stages = new Map<number, PhaseDetail[]>();
  for (const p of phases) {
    let arr = stages.get(p.seq);
    if (!arr) {
      arr = [];
      stages.set(p.seq, arr);
    }
    arr.push(p);
  }
  const orderedStages = Array.from(stages.entries()).sort(
    ([a], [b]) => a - b
  );

  return (
    <div className="space-y-2">
      {orderedStages.map(([seq, branch]) => (
        <StageRow key={seq} phases={branch} />
      ))}
    </div>
  );
}

function StageRow({ phases }: { phases: PhaseDetail[] }) {
  // All phases in a stage share the same kind
  const kind = phases[0].kind;
  const meta = PHASE_META[kind];
  const isParallel = phases.length > 1;

  if (isParallel) {
    return (
      <div className="bg-carbon border border-charcoal rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className={`text-sm ${meta.color}`}>{meta.icon}</span>
          <span className="text-xs font-medium text-snow uppercase tracking-wider">
            {meta.label}
          </span>
          <span className="text-[11px] text-slate-steel font-mono">
            {phases.filter((p) => p.status === "completed").length}/{phases.length}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {phases.map((p) => (
            <PhaseRow key={p.id} phase={p} compact />
          ))}
        </div>
      </div>
    );
  }

  return <PhaseRow phase={phases[0]} />;
}

function PhaseRow({
  phase,
  compact = false,
}: {
  phase: PhaseDetail;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = PHASE_META[phase.kind];
  const duration = formatDuration(phase);
  const tools = toolCount(phase);

  return (
    <div
      className={`bg-carbon border border-charcoal rounded-md transition-colors ${
        open ? "border-charcoal-light" : "hover:border-charcoal-light"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center gap-2.5 text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(phase.status)}`} />
        {!compact && (
          <span className={`text-sm shrink-0 ${meta.color}`}>{meta.icon}</span>
        )}
        <span className="text-[13px] text-snow flex-1 truncate">
          {phase.label}
        </span>
        {phase.usage?.total_tokens !== undefined && (
          <span className="text-[10px] font-mono text-slate-steel shrink-0">
            {phase.usage.total_tokens > 1000
              ? `${(phase.usage.total_tokens / 1000).toFixed(1)}k`
              : phase.usage.total_tokens}
          </span>
        )}
        {duration && (
          <span className="text-[10px] font-mono text-slate-steel shrink-0">
            {duration}
          </span>
        )}
        {tools > 0 && (
          <span className="text-[10px] text-slate-steel shrink-0">
            {tools}🔧
          </span>
        )}
        <span className="text-slate-steel text-[10px] shrink-0 select-none">
          {open ? "▼" : "▶"}
        </span>
      </button>

      {open && <PhaseBody phase={phase} />}
    </div>
  );
}

function PhaseBody({ phase }: { phase: PhaseDetail }) {
  const hasOutput = phase.output.trim().length > 0;
  const hasEvents = phase.events.length > 0;

  return (
    <div className="border-t border-charcoal-subtle px-3 py-3 space-y-3">
      {phase.error && (
        <div className="bg-danger-dim border border-danger/20 rounded-md px-3 py-2 text-xs text-danger">
          {phase.error}
        </div>
      )}

      {hasOutput && (
        <div>
          <div className="text-[10px] text-slate-steel uppercase tracking-wider mb-1.5">
            Output
          </div>
          <div className="bg-abyss border border-charcoal-subtle rounded-md px-3 py-2.5 max-h-[320px] overflow-y-auto">
            <div className="prose-hermes prose-hermes-compact">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {phase.output}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {hasEvents && (
        <div>
          <div className="text-[10px] text-slate-steel uppercase tracking-wider mb-1.5">
            Tool activity
          </div>
          <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
            {phase.events
              .filter(
                (e) =>
                  e.event === "tool.started" ||
                  e.event === "tool.completed" ||
                  e.event === "reasoning.available"
              )
              .map((ev, i) => (
                <EventRow key={i} event={ev} />
              ))}
          </div>
        </div>
      )}

      {!hasOutput && !hasEvents && phase.status === "running" && (
        <div className="text-xs text-agent-thinking animate-pulse">
          Working...
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: PhaseDetail["events"][number] }) {
  if (event.event === "tool.started") {
    return (
      <div className="text-[11px] text-slate-steel flex gap-2 font-mono">
        <span className="text-tool-call">▸</span>
        <span className="text-snow">{event.tool}</span>
        {event.preview && (
          <span className="text-slate-steel truncate">{event.preview}</span>
        )}
      </div>
    );
  }
  if (event.event === "tool.completed") {
    const dur = event.duration;
    return (
      <div className="text-[11px] text-slate-steel flex gap-2 font-mono">
        <span className={event.error ? "text-danger" : "text-success"}>
          {event.error ? "✗" : "✓"}
        </span>
        <span>{event.tool}</span>
        {dur !== undefined && (
          <span className="ml-auto">
            {dur < 1 ? `${Math.round(dur * 1000)}ms` : `${dur.toFixed(1)}s`}
          </span>
        )}
      </div>
    );
  }
  if (event.event === "reasoning.available") {
    return (
      <div className="text-[11px] text-agent-thinking/80 italic flex gap-2">
        <span>💭</span>
        <span className="line-clamp-2">{event.text}</span>
      </div>
    );
  }
  return null;
}
