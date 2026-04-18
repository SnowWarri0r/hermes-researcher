import type { TokenUsage } from "../../types";

/**
 * Structured tooltip content explaining the cumulative token usage.
 * Three visual tiers: label (dim), value (snow mono), caption (slate italic).
 */
export function UsageTooltip({ usage }: { usage: TokenUsage }) {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const total = usage.total_tokens ?? input + output;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-snow">Token usage</div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-slate-steel">Input</span>
        <span className="text-snow font-mono text-right">{input.toLocaleString()}</span>

        <span className="text-slate-steel">Output</span>
        <span className="text-emerald-signal font-mono text-right">{output.toLocaleString()}</span>

        <span className="text-slate-steel">Total</span>
        <span className="text-snow font-mono text-right">{total.toLocaleString()}</span>
      </div>

      <div className="text-[10px] text-slate-steel/70 leading-snug border-t border-charcoal-subtle pt-1.5">
        Input is cumulative — each tool-call round re-sends the full conversation. Prompt caching typically bills input at ~10-20% of this.
      </div>
    </div>
  );
}
