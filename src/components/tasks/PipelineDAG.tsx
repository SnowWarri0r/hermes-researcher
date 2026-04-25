import { useMemo } from "react";
import type { PhaseDetail, PhaseKind, PhaseStatus } from "../../types";

const PHASE_LABEL: Record<PhaseKind, string> = {
  plan: "Plan",
  research: "Research",
  draft: "Draft",
  critique: "Critique",
  revise: "Revise",
  write: "Write",
};

// Distinct nodes in our pipeline (ordered). Research fans out; others are 1-wide.
// Special labels (Plan review / Thesis / Outline / Copy edit) live on the
// critique/revise `kind` — we disambiguate by phase.label.
type NodeKey = {
  seq: number;
  branch: number;
  label: string;
  kind: PhaseKind;
  status: PhaseStatus;
  duration?: number;
};

function nodeKeyFromPhase(p: PhaseDetail): NodeKey {
  const duration =
    p.completedAt && p.createdAt ? (p.completedAt - p.createdAt) / 1000 : undefined;
  return {
    seq: p.seq,
    branch: p.branch,
    label: p.label,
    kind: p.kind,
    status: p.status,
    duration,
  };
}

// Compact display label — trim long research-question titles.
function compactLabel(n: NodeKey): string {
  const l = n.label;
  // Research: "Q1: <question>" → "Q1 · <truncated>"
  const m = l.match(/^([QS]\d+):\s*(.+)$/);
  if (m) {
    const [, id, rest] = m;
    const short = rest.length > 22 ? rest.slice(0, 20) + "…" : rest;
    return `${id} · ${short}`;
  }
  if (l.length > 26) return l.slice(0, 24) + "…";
  return l;
}

const COL_W = 130;
const COL_GAP = 44;
const NODE_H = 34;
const NODE_GAP = 10;
const PAD_X = 14;
const PAD_Y = 14;

type LayoutNode = NodeKey & { x: number; y: number; w: number; h: number };
type LayoutEdge = { from: LayoutNode; to: LayoutNode; highlight?: boolean };

function layout(phases: PhaseDetail[]): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  // Group by seq.
  const bySeq = new Map<number, PhaseDetail[]>();
  for (const p of phases) {
    const arr = bySeq.get(p.seq) ?? [];
    arr.push(p);
    bySeq.set(p.seq, arr);
  }
  const seqs = Array.from(bySeq.keys()).sort((a, b) => a - b);

  const nodesByKey = new Map<string, LayoutNode>();
  let maxRowHeight = 0;
  const columnNodes: LayoutNode[][] = [];

  seqs.forEach((seq, colIdx) => {
    const phasesInSeq = bySeq.get(seq)!.slice().sort((a, b) => a.branch - b.branch);
    const x = PAD_X + colIdx * (COL_W + COL_GAP);
    const col: LayoutNode[] = [];
    phasesInSeq.forEach((p, rowIdx) => {
      const y = PAD_Y + rowIdx * (NODE_H + NODE_GAP);
      const n: LayoutNode = { ...nodeKeyFromPhase(p), x, y, w: COL_W, h: NODE_H };
      col.push(n);
      nodesByKey.set(`${seq}-${p.branch}-${p.label}`, n);
      if (y + NODE_H > maxRowHeight) maxRowHeight = y + NODE_H;
    });
    columnNodes.push(col);
  });

  // Build edges: every node in col N+1 connects back to every node in col N.
  // This is approximate — we don't have real edge metadata on each phase.
  const edges: LayoutEdge[] = [];
  for (let i = 1; i < columnNodes.length; i++) {
    for (const to of columnNodes[i]) {
      for (const from of columnNodes[i - 1]) {
        const highlight = from.status === "completed" && to.status !== "pending";
        edges.push({ from, to, highlight });
      }
    }
  }

  const width = PAD_X * 2 + columnNodes.length * COL_W + (columnNodes.length - 1) * COL_GAP;
  const height = Math.max(maxRowHeight + PAD_Y, 80);
  return { nodes: Array.from(nodesByKey.values()), edges, width, height };
}

function nodeColor(status: PhaseStatus) {
  switch (status) {
    case "running":
      return { fill: "rgba(0,217,146,0.14)", stroke: "#00d992", text: "#00d992" };
    case "completed":
      return { fill: "rgba(0,217,146,0.06)", stroke: "#00d99266", text: "#f2f2f2" };
    case "failed":
      return { fill: "rgba(251,86,91,0.1)", stroke: "#fb565b", text: "#fb565b" };
    case "skipped":
      return { fill: "transparent", stroke: "#2a2d33", text: "#6f747c" };
    default:
      return { fill: "#0a0b0d", stroke: "#2a2d33", text: "#8b949e" };
  }
}

function statusBadge(status: PhaseStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "●";
    case "failed":
      return "✕";
    case "skipped":
      return "—";
    default:
      return "○";
  }
}

export function PipelineDAG({ phases }: { phases: PhaseDetail[] }) {
  const l = useMemo(() => layout(phases), [phases]);
  const doneCount = phases.filter((p) => p.status === "completed").length;
  const runningCount = phases.filter((p) => p.status === "running").length;
  const pendingCount = phases.filter(
    (p) => p.status === "pending" || p.status === "skipped"
  ).length;
  const failedCount = phases.filter((p) => p.status === "failed").length;

  if (phases.length === 0) {
    return (
      <div className="text-[11px] text-slate-steel italic px-3 py-2">
        No phases yet
      </div>
    );
  }

  return (
    <div className="bg-carbon border border-charcoal rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-subtle bg-abyss/50">
        <span className="text-[10px] font-mono text-slate-steel tracking-[0.18em]">
          PIPELINE · DAG
        </span>
        <div className="flex-1" />
        <LegendDot color="var(--color-emerald-signal)" label={`${doneCount} done`} />
        {runningCount > 0 && (
          <LegendDot
            color="var(--color-emerald-signal)"
            glow
            label={`${runningCount} live`}
          />
        )}
        {pendingCount > 0 && (
          <LegendDot color="#2a2d33" label={`${pendingCount} pending`} />
        )}
        {failedCount > 0 && (
          <LegendDot color="var(--color-danger)" label={`${failedCount} failed`} />
        )}
      </div>

      <div className="overflow-x-auto">
        <svg
          width={l.width}
          height={l.height}
          viewBox={`0 0 ${l.width} ${l.height}`}
          className="block min-w-full"
          role="img"
          aria-label="Pipeline DAG"
        >
          <defs>
            <marker
              id="dag-arrow-dim"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="#2a2d33" />
            </marker>
            <marker
              id="dag-arrow-accent"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="#00d99288" />
            </marker>
          </defs>

          {/* Edges drawn first so nodes sit on top */}
          {l.edges.map((e, i) => {
            const x1 = e.from.x + e.from.w;
            const y1 = e.from.y + e.from.h / 2;
            const x2 = e.to.x;
            const y2 = e.to.y + e.to.h / 2;
            const midX = (x1 + x2) / 2;
            const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            const stroke = e.highlight ? "#00d99266" : "#2a2d33";
            const marker = e.highlight ? "url(#dag-arrow-accent)" : "url(#dag-arrow-dim)";
            return (
              <path
                key={i}
                d={d}
                stroke={stroke}
                strokeWidth="1"
                fill="none"
                markerEnd={marker}
                strokeDasharray={e.from.status === "pending" ? "3 3" : undefined}
              />
            );
          })}

          {/* Nodes */}
          {l.nodes.map((n, i) => {
            const c = nodeColor(n.status);
            const label = compactLabel(n);
            return (
              <g key={i}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx="4"
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={n.status === "running" ? 1.5 : 1}
                />
                {n.status === "running" && (
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx="4"
                    fill="none"
                    stroke="#00d992"
                    strokeWidth="2"
                    opacity="0.25"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.05;0.35;0.05"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                  </rect>
                )}
                <text
                  x={n.x + 9}
                  y={n.y + 14}
                  fontSize="11"
                  fill={c.text}
                  fontWeight={n.status === "running" ? 600 : 500}
                >
                  {label}
                </text>
                <text
                  x={n.x + 9}
                  y={n.y + 27}
                  fontSize="9"
                  fill={n.status === "running" ? "#00d992" : "#6f747c"}
                  fontFamily="var(--font-mono)"
                  letterSpacing="0.06em"
                >
                  {statusBadge(n.status)}{" "}
                  {n.duration !== undefined
                    ? `${n.duration.toFixed(1)}s`
                    : n.status === "running"
                    ? "running"
                    : n.status === "pending"
                    ? "pending"
                    : n.status === "failed"
                    ? "failed"
                    : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function LegendDot({
  color,
  label,
  glow,
}: {
  color: string;
  label: string;
  glow?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 text-[9px] font-mono text-slate-steel tracking-[0.08em]">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: color,
          boxShadow: glow ? `0 0 6px ${color}` : undefined,
        }}
      />
      {label.toUpperCase()}
    </span>
  );
}
