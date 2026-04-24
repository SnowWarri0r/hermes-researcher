import { useMemo } from "react";
import type { PhaseDetail, TaskEvent } from "../../types";

type Row = {
  ts: number;
  branch: string;
  event: string;
  message: string;
  tone: "accent" | "dim" | "done" | "warn" | "danger";
};

const MAX_ROWS = 15;

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function branchTag(phase: PhaseDetail): string {
  // Research: "Q1: …" → "Q1"
  const m = phase.label.match(/^([QS]\d+):/);
  if (m) return m[1];
  // Capitalised phase kinds shortened
  switch (phase.kind) {
    case "plan":
      return phase.label.startsWith("Plan review") ? "REV" : phase.label.startsWith("Plan (revised") ? "RE" : "PLN";
    case "draft":
      return "DRF";
    case "critique":
      return phase.label.startsWith("Thesis") ? "THS" : phase.label.startsWith("Outline") ? "OUT" : phase.label.startsWith("Plan review") ? "REV" : phase.label.startsWith("Self-critique") || phase.label.startsWith("Re-critique") ? "CRT" : phase.label.startsWith("Copy edit") ? "EDT" : "CRT";
    case "revise":
      return phase.label.startsWith("Copy edit") ? "EDT" : "REV";
    case "research":
      return "RES";
    case "write":
      return "WRT";
    default:
      return "—";
  }
}

function interpretEvent(ev: TaskEvent): { label: string; msg: string; tone: Row["tone"] } {
  if (ev.event === "tool.started") {
    return {
      label: ev.tool || "tool",
      msg: ev.preview || "",
      tone: "accent",
    };
  }
  if (ev.event === "tool.completed") {
    const dur = ev.duration ? ` · ${ev.duration.toFixed(1)}s` : "";
    return { label: "✓ " + (ev.tool || "tool"), msg: `completed${dur}`, tone: "done" };
  }
  if (ev.event === "reasoning.available" || ev.event === "reasoning.delta") {
    return { label: "reasoning", msg: ev.text?.slice(0, 80) || "(thinking)", tone: "dim" };
  }
  if (ev.event === "run.started") return { label: "run.started", msg: "", tone: "dim" };
  if (ev.event === "run.completed") return { label: "✓ run", msg: "", tone: "done" };
  if (ev.event === "run.failed") return { label: "✕ run", msg: ev.error ? String(ev.error) : "failed", tone: "danger" };
  return { label: ev.event, msg: ev.preview || ev.text?.slice(0, 60) || "", tone: "dim" };
}

export function EventLogTail({ phases }: { phases: PhaseDetail[] }) {
  const rows = useMemo(() => {
    const all: Row[] = [];
    for (const p of phases) {
      const tag = branchTag(p);
      // Phase lifecycle synthetic rows
      if (p.createdAt) {
        all.push({
          ts: p.createdAt / 1000,
          branch: tag,
          event: "phase.started",
          message: p.label,
          tone: "dim",
        });
      }
      for (const ev of p.events ?? []) {
        const parsed = interpretEvent(ev);
        all.push({
          ts: ev.timestamp,
          branch: tag,
          event: parsed.label,
          message: parsed.msg,
          tone: parsed.tone,
        });
      }
      if (p.completedAt && p.status === "completed") {
        const dur = p.createdAt ? ((p.completedAt - p.createdAt) / 1000).toFixed(1) : "";
        all.push({
          ts: p.completedAt / 1000,
          branch: tag,
          event: "✓ done",
          message: `${p.toolCount ?? 0} tools · ${dur}s`,
          tone: "done",
        });
      } else if (p.completedAt && p.status === "failed") {
        all.push({
          ts: p.completedAt / 1000,
          branch: tag,
          event: "✕ fail",
          message: p.error || "failed",
          tone: "danger",
        });
      }
    }
    all.sort((a, b) => b.ts - a.ts);
    return all.slice(0, MAX_ROWS);
  }, [phases]);

  if (rows.length === 0) return null;

  const toneClass = (t: Row["tone"]) =>
    t === "accent"
      ? "text-emerald-signal"
      : t === "done"
      ? "text-info"
      : t === "warn"
      ? "text-warning"
      : t === "danger"
      ? "text-danger"
      : "text-parchment";

  return (
    <div className="bg-carbon border border-charcoal rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-subtle bg-abyss/50">
        <span className="text-[10px] font-mono text-slate-steel tracking-[0.18em]">
          EVENT LOG · TAIL
        </span>
        <div className="flex-1" />
        <span className="text-[9px] font-mono text-slate-steel/70">
          last {rows.length}
        </span>
      </div>
      <div className="px-3 py-2 max-h-[240px] overflow-y-auto">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 text-[10.5px] font-mono py-[2px]"
            style={{ gridTemplateColumns: "92px 40px 110px 1fr" }}
          >
            <span className="text-slate-steel/70 truncate">{formatTime(r.ts)}</span>
            <span className="text-emerald-signal tracking-[0.06em]">{r.branch}</span>
            <span className={`truncate ${toneClass(r.tone)}`}>{r.event}</span>
            <span className="text-parchment truncate">{r.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
