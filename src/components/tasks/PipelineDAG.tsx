import { useMemo } from "react";
import type { PhaseDetail, PhaseStatus } from "../../types";

// ---------------------------------------------------------------------------
// Parse plan.questions (with optional depends_on) out of the plan phase's output.
// Server side owns the canonical parser; we re-do a lightweight version here so
// the DAG can reason about real dependencies without widening the API surface.
// ---------------------------------------------------------------------------
interface ParsedQuestion {
  id: string;
  depends_on: string[];
}

function parsePlanQuestions(planOutput: string): ParsedQuestion[] {
  // Match the FIRST fenced JSON block, fall back to raw text parse.
  const blockRe = /```json\s*([\s\S]*?)```/i;
  const m = planOutput.match(blockRe);
  const candidate = (m ? m[1] : planOutput).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .filter((q: unknown) => typeof q === "object" && q !== null && "id" in (q as object))
      .map((q: { id?: unknown; depends_on?: unknown }) => ({
        id: typeof q.id === "string" ? q.id : "",
        depends_on: Array.isArray(q.depends_on)
          ? q.depends_on.filter((d: unknown): d is string => typeof d === "string")
          : [],
      }))
      .filter((q: ParsedQuestion) => q.id.length > 0);
  } catch {
    return [];
  }
}

function questionIdFromLabel(label: string): string | null {
  const m = label.match(/^([QS]\d+):/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Layout: map phases → typed groups → columns → nodes + edges.
// ---------------------------------------------------------------------------

type PhaseKindFlavor =
  | "plan"
  | "plan-review"
  | "plan-revised"
  | "research"
  | "thesis"
  | "outline"
  | "draft"
  | "critique"
  | "revise"
  | "re-critique"
  | "editor"
  | "write";

function classifyPhase(p: PhaseDetail): PhaseKindFlavor {
  if (p.kind === "research") return "research";
  if (p.kind === "draft") return "draft";
  if (p.kind === "write") return "write";
  if (p.kind === "plan") {
    if (p.branch === 2 || p.label.startsWith("Plan (revised")) return "plan-revised";
    return "plan";
  }
  if (p.kind === "critique") {
    if (p.label.startsWith("Plan review")) return "plan-review";
    if (p.label.startsWith("Thesis")) return "thesis";
    if (p.label.startsWith("Outline")) return "outline";
    if (p.label.startsWith("Re-critique")) return "re-critique";
    if (p.label.startsWith("Self-critique") || p.label.startsWith("Critique")) return "critique";
    if (p.label.startsWith("Copy edit")) return "editor";
    return "critique";
  }
  if (p.kind === "revise") {
    if (p.label.startsWith("Copy edit")) return "editor";
    return "revise";
  }
  return "plan";
}

const KIND_SHORT: Record<PhaseKindFlavor, string> = {
  plan: "Plan",
  "plan-review": "Plan review",
  "plan-revised": "Plan (revised)",
  research: "Research",
  thesis: "Thesis",
  outline: "Outline",
  draft: "Draft",
  critique: "Critique",
  revise: "Revise",
  "re-critique": "Re-critique",
  editor: "Copy edit",
  write: "Write",
};

function shortLabel(p: PhaseDetail, flavor: PhaseKindFlavor): string {
  if (flavor === "research") {
    // "Q1: title" → keep whole title (we wrap in two lines downstream)
    return p.label;
  }
  return KIND_SHORT[flavor] ?? p.label;
}

// Rough per-character width at the DAG's 11px text size. CJK is roughly
// full-width, Latin is half-width. Used to estimate how many lines the
// browser will render so we can reserve height.
function estimateCharWidth(c: string, fontSize = 11): number {
  if (/[　-鿿＀-￯가-힯]/.test(c)) return fontSize;
  return fontSize * 0.55;
}

function countWrapLines(text: string, maxPx: number, fontSize = 11): number {
  // Walk char by char; whenever width exceeds maxPx, start a new line.
  // Prefer word boundaries for Latin-majority text but also handle CJK.
  let lines = 1;
  let lineW = 0;
  let sinceSpace = 0;
  for (const c of text) {
    const cw = estimateCharWidth(c, fontSize);
    if (lineW + cw > maxPx) {
      // Break. If we can go back to last space, do so.
      lines++;
      if (sinceSpace > 0 && /[A-Za-z0-9]/.test(c)) {
        lineW = sinceSpace + cw; // carry the current word
      } else {
        lineW = cw;
      }
      sinceSpace = 0;
    } else {
      lineW += cw;
      if (/\s/.test(c)) sinceSpace = 0;
      else sinceSpace += cw;
    }
  }
  return lines;
}

type LayoutNode = {
  id: string;                 // stable key: phase.id as string
  label: string;              // full display label (wraps via foreignObject)
  flavor: PhaseKindFlavor;
  status: PhaseStatus;
  duration?: number;
  stage: number;              // vertical stage (top→bottom flow)
  lane: number;               // horizontal lane within a stage
  x: number;
  y: number;
  w: number;
  h: number;
  // For research nodes, keep the question id (Q1/S1/...) for edge mapping
  qid?: string;
};

type LayoutEdge = {
  fromId: string;
  toId: string;
  style: "solid" | "dashed" | "loop";
  highlight: boolean;
};

// Node width scheme: research questions need more room for the full title;
// pipeline phases fit in a narrower box.
function widthFor(flavor: PhaseKindFlavor): number {
  if (flavor === "research") return 220;
  if (flavor === "plan-revised" || flavor === "plan-review" || flavor === "re-critique") return 150;
  return 140;
}

// Text constants
const TEXT_FS = 11;      // px
const LINE_H = 15;       // px per wrapped line
const NODE_PAD_X = 10;   // inner padding for the text foreignObject
const NODE_PAD_TOP = 6;
const STATUS_LINE_H = 14;
const NODE_MIN_H = 40;

function heightFor(label: string, width: number): number {
  const innerW = width - NODE_PAD_X * 2;
  const lines = countWrapLines(label, innerW, TEXT_FS);
  const h = NODE_PAD_TOP + lines * LINE_H + STATUS_LINE_H + 6;
  return Math.max(NODE_MIN_H, h);
}

// Top-to-bottom flow: stages stack vertically; nodes within a stage spread
// horizontally across lanes.
const GAP_STAGE = 36;   // vertical gap between stages
const GAP_LANE = 14;    // horizontal gap between lanes
const PAD_X = 16;
const PAD_Y = 18;

function buildLayout(phases: PhaseDetail[]): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  busX: number;
} {
  // ---- Group phases by flavor (filter empty) ----
  const byFlavor = new Map<PhaseKindFlavor, PhaseDetail[]>();
  for (const p of phases) {
    const f = classifyPhase(p);
    const arr = byFlavor.get(f) ?? [];
    arr.push(p);
    byFlavor.set(f, arr);
  }

  const planNode = byFlavor.get("plan")?.[0];
  const planReviewNode = byFlavor.get("plan-review")?.[0];
  const planRevisedNode = byFlavor.get("plan-revised")?.[0];
  const researchNodes = (byFlavor.get("research") ?? []).slice().sort((a, b) => a.branch - b.branch);
  const thesisNode = byFlavor.get("thesis")?.[0];
  const outlineNode = byFlavor.get("outline")?.[0];
  const draftNode = byFlavor.get("draft")?.[0];
  const writeNode = byFlavor.get("write")?.[0];
  const critiqueNodes = (byFlavor.get("critique") ?? []).slice().sort((a, b) => a.seq - b.seq);
  const reCritiqueNodes = (byFlavor.get("re-critique") ?? []).slice().sort((a, b) => a.seq - b.seq);
  const reviseNodes = (byFlavor.get("revise") ?? []).slice().sort((a, b) => a.seq - b.seq);
  const editorNode = byFlavor.get("editor")?.[0];

  // ---- Parse depends_on from the plan output ----
  const planOutput = planRevisedNode?.output || planNode?.output || "";
  const qMeta = parsePlanQuestions(planOutput);
  const depsById = new Map<string, string[]>();
  for (const q of qMeta) depsById.set(q.id, q.depends_on);

  // Research sub-levels via topological walk
  const researchByQid = new Map<string, PhaseDetail>();
  for (const p of researchNodes) {
    const qid = questionIdFromLabel(p.label);
    if (qid) researchByQid.set(qid, p);
  }
  // If a research phase lacks metadata, treat as level 0.
  const qIdsPresent = new Set(researchByQid.keys());
  const levelByQid = new Map<string, number>();
  const MAX_LEVELS = 8;
  // Iteratively assign levels.
  for (const qid of qIdsPresent) {
    if (!depsById.has(qid)) levelByQid.set(qid, 0);
  }
  for (let iter = 0; iter < MAX_LEVELS; iter++) {
    let changed = false;
    for (const qid of qIdsPresent) {
      if (levelByQid.has(qid)) continue;
      const deps = (depsById.get(qid) ?? []).filter((d) => qIdsPresent.has(d));
      if (deps.every((d) => levelByQid.has(d))) {
        const lvl = deps.length === 0 ? 0 : Math.max(...deps.map((d) => levelByQid.get(d)!)) + 1;
        levelByQid.set(qid, lvl);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Anyone still unassigned — cycles or missing deps — dump to level 0.
  for (const qid of qIdsPresent) {
    if (!levelByQid.has(qid)) levelByQid.set(qid, 0);
  }
  const maxResearchLevel = researchNodes.length > 0
    ? Math.max(0, ...Array.from(levelByQid.values()))
    : -1;

  // ---- Assign stages in top-to-bottom order ----
  // stage sequence (vertical): plan | plan-review | plan-revised |
  //   research L0 | research L1 | ... | thesis | outline | draft/write |
  //   critique | revise+re-critique interleaved | editor
  type SlotNode = { phase: PhaseDetail; flavor: PhaseKindFlavor; qid?: string };
  const stages: SlotNode[][] = [];

  if (planNode) stages.push([{ phase: planNode, flavor: "plan" }]);
  if (planReviewNode) stages.push([{ phase: planReviewNode, flavor: "plan-review" }]);
  if (planRevisedNode) stages.push([{ phase: planRevisedNode, flavor: "plan-revised" }]);

  if (researchNodes.length > 0) {
    for (let lvl = 0; lvl <= maxResearchLevel; lvl++) {
      const stage: SlotNode[] = [];
      for (const p of researchNodes) {
        const qid = questionIdFromLabel(p.label);
        const pLvl = qid ? levelByQid.get(qid) ?? 0 : 0;
        if (pLvl === lvl) stage.push({ phase: p, flavor: "research", qid: qid ?? undefined });
      }
      if (stage.length > 0) stages.push(stage);
    }
  }

  if (thesisNode) stages.push([{ phase: thesisNode, flavor: "thesis" }]);
  if (outlineNode) stages.push([{ phase: outlineNode, flavor: "outline" }]);
  if (draftNode) stages.push([{ phase: draftNode, flavor: "draft" }]);
  else if (writeNode) stages.push([{ phase: writeNode, flavor: "write" }]);

  // For the critique/revise interleave, order by seq; each gets its own stage.
  const critRev = [
    ...critiqueNodes.map((p): SlotNode => ({ phase: p, flavor: "critique" })),
    ...reCritiqueNodes.map((p): SlotNode => ({ phase: p, flavor: "re-critique" })),
    ...reviseNodes.map((p): SlotNode => ({ phase: p, flavor: "revise" })),
  ].sort((a, b) => a.phase.seq - b.phase.seq);
  for (const sn of critRev) stages.push([sn]);

  if (editorNode) stages.push([{ phase: editorNode, flavor: "editor" }]);

  // ---- Place nodes: each stage is a horizontal band; lanes spread sideways ----
  const nodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();

  // First pass: build all node objects with width + height; defer x/y.
  const pending: { sn: SlotNode; node: LayoutNode; stageIdx: number }[] = [];
  stages.forEach((stage, stageIdx) => {
    stage.forEach((sn, laneIdx) => {
      const w = widthFor(sn.flavor);
      const label = shortLabel(sn.phase, sn.flavor);
      const h = heightFor(label, w);
      const node: LayoutNode = {
        id: String(sn.phase.id),
        label,
        flavor: sn.flavor,
        status: sn.phase.status,
        duration:
          sn.phase.completedAt && sn.phase.createdAt
            ? (sn.phase.completedAt - sn.phase.createdAt) / 1000
            : undefined,
        stage: stageIdx,
        lane: laneIdx,
        x: 0,
        y: 0,
        w,
        h,
        qid: sn.qid,
      };
      pending.push({ sn, node, stageIdx });
    });
  });

  // Compute each stage's horizontal span and overall width.
  const stageInfo = stages.map((stage) => {
    const totalW = stage.reduce((acc, sn) => acc + widthFor(sn.flavor), 0) + Math.max(0, (stage.length - 1) * GAP_LANE);
    return { totalW };
  });
  const widestStage = Math.max(0, ...stageInfo.map((s) => s.totalW));
  const width = widestStage + PAD_X * 2;

  // Place stages top to bottom; center each stage horizontally.
  let cursorY = PAD_Y;
  stages.forEach((stage, stageIdx) => {
    const { totalW } = stageInfo[stageIdx];
    const startX = PAD_X + (widestStage - totalW) / 2;
    let cursorX = startX;
    let rowHeight = 0;
    for (const sn of stage) {
      const p = pending.find((x) => x.sn === sn)!;
      const n = p.node;
      n.x = cursorX;
      n.y = cursorY;
      cursorX += n.w + GAP_LANE;
      if (n.h > rowHeight) rowHeight = n.h;
      nodes.push(n);
      nodeById.set(n.id, n);
    }
    cursorY += rowHeight + GAP_STAGE;
  });

  let height = cursorY - GAP_STAGE + PAD_Y;

  // ---- Build edges ----
  const edges: LayoutEdge[] = [];
  const nodeOf = (p: PhaseDetail | undefined): LayoutNode | undefined =>
    p ? nodeById.get(String(p.id)) : undefined;

  const planN = nodeOf(planNode);
  const reviewN = nodeOf(planReviewNode);
  const revisedN = nodeOf(planRevisedNode);
  const thesisN = nodeOf(thesisNode);
  const outlineN = nodeOf(outlineNode);
  const draftN = nodeOf(draftNode) ?? nodeOf(writeNode);

  function pushEdge(from: LayoutNode | undefined, to: LayoutNode | undefined, style: LayoutEdge["style"] = "solid") {
    if (!from || !to) return;
    const highlight = from.status === "completed" && to.status !== "pending";
    edges.push({ fromId: from.id, toId: to.id, style, highlight });
  }

  // Plan chain
  pushEdge(planN, reviewN);
  pushEdge(reviewN, revisedN);

  // Effective plan → level-0 research
  const effectivePlan = revisedN ?? reviewN ?? planN;
  const researchLayoutById = new Map<string, LayoutNode>();
  for (const n of nodes) {
    if (n.flavor === "research" && n.qid) researchLayoutById.set(n.qid, n);
  }
  // Level-0 research from effective plan
  const l0 = Array.from(researchLayoutById.entries()).filter(([qid]) => (levelByQid.get(qid) ?? 0) === 0);
  for (const [, n] of l0) pushEdge(effectivePlan, n);

  // Within-research depends_on edges
  for (const n of nodes) {
    if (n.flavor !== "research" || !n.qid) continue;
    const deps = depsById.get(n.qid) ?? [];
    for (const depQid of deps) {
      const fromNode = researchLayoutById.get(depQid);
      if (fromNode) pushEdge(fromNode, n);
    }
  }

  // Research → thesis: fan-in from TERMINAL research only.
  // A terminal research node is one that no other research depends on.
  // Non-terminal research's findings reach thesis transitively via the
  // depends_on chain — drawing every research-to-thesis edge clutters the
  // view and (worse) routes lines through intermediate research nodes.
  if (thesisN || researchNodes.length > 0) {
    const hasOutgoingDep = new Set<string>();
    for (const n of nodes) {
      if (n.flavor !== "research" || !n.qid) continue;
      const deps = depsById.get(n.qid) ?? [];
      for (const d of deps) hasOutgoingDep.add(d);
    }
    const terminals = nodes.filter(
      (n) => n.flavor === "research" && n.qid && !hasOutgoingDep.has(n.qid)
    );
    // If no metadata, every research is its own terminal.
    const effectiveTerminals = terminals.length > 0 ? terminals : nodes.filter((n) => n.flavor === "research");
    const nextAfterResearch = thesisN ?? outlineN ?? draftN;
    if (nextAfterResearch) {
      for (const n of effectiveTerminals) pushEdge(n, nextAfterResearch);
    }
  }

  pushEdge(thesisN, outlineN);
  pushEdge(outlineN, draftN);

  // Critique/revise interleaved chain (seq-ordered)
  const chain: LayoutNode[] = [];
  for (const p of critRev) {
    const n = nodeOf(p.phase);
    if (n) chain.push(n);
  }
  if (draftN && chain[0]) pushEdge(draftN, chain[0]);
  for (let i = 1; i < chain.length; i++) pushEdge(chain[i - 1], chain[i]);

  // Editor at the end of chain
  const editorN = nodeOf(editorNode);
  if (editorN) {
    const tail = chain[chain.length - 1] ?? draftN;
    pushEdge(tail, editorN);
  }

  // Loop-back arrow for revise → re-critique would be redundant since they
  // form a forward chain by seq. If there's a `re-critique` in the chain,
  // draw a subtle dashed loop from the previous `revise` back up suggesting
  // the quality-gate retry. We detect re-critiques and add a `loop` edge.
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    if (n.flavor === "re-critique" && i >= 1) {
      // The re-critique was triggered by a failed quality gate on the previous revise.
      edges.push({ fromId: chain[i - 1].id, toId: n.id, style: "loop", highlight: false });
    }
  }

  // Cross-stage edges (stage diff > 1) route via a vertical "bus lane" on
  // the right side so they don't slash through intermediate nodes.
  const hasCrossStage = edges.some((e) => {
    const fn = nodeById.get(e.fromId);
    const tn = nodeById.get(e.toId);
    return fn && tn && tn.stage - fn.stage > 1;
  });
  // Loop edges swing left of the node column.
  const hasLoop = edges.some((e) => e.style === "loop");

  // Reserve right-side gutter for bus lane; left-side for loop arches.
  const busX = hasCrossStage ? width + 6 : width;
  const totalWidth = busX + (hasCrossStage ? 24 : 0);
  const loopGutter = hasLoop ? 26 : 0;
  const finalWidth = totalWidth + loopGutter;
  // Shift every node rightward by loopGutter so loop arches have room on the left.
  if (loopGutter > 0) for (const n of nodes) n.x += loopGutter;

  return { nodes, edges, width: finalWidth, height, busX: busX + loopGutter };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function nodeTheme(status: PhaseStatus) {
  switch (status) {
    case "running":
      return { fill: "rgba(0,217,146,0.14)", stroke: "#00d992", text: "#00d992", dim: "#00d992" };
    case "completed":
      return { fill: "rgba(0,217,146,0.05)", stroke: "#00d99255", text: "#f2f2f2", dim: "#8b949e" };
    case "failed":
      return { fill: "rgba(251,86,91,0.08)", stroke: "#fb565b", text: "#fb565b", dim: "#fb565b" };
    case "skipped":
      return { fill: "transparent", stroke: "#2a2d33", text: "#6f747c", dim: "#6f747c" };
    default:
      return { fill: "#0a0b0d", stroke: "#2a2d33", text: "#8b949e", dim: "#6f747c" };
  }
}

function statusIcon(status: PhaseStatus): string {
  switch (status) {
    case "completed": return "✓";
    case "running": return "●";
    case "failed": return "✕";
    case "skipped": return "—";
    default: return "○";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineDAG({ phases }: { phases: PhaseDetail[] }) {
  const l = useMemo(() => buildLayout(phases), [phases]);
  const doneCount = phases.filter((p) => p.status === "completed").length;
  const runningCount = phases.filter((p) => p.status === "running").length;
  const pendingCount = phases.filter((p) => p.status === "pending" || p.status === "skipped").length;
  const failedCount = phases.filter((p) => p.status === "failed").length;

  if (phases.length === 0) {
    return (
      <div className="text-[11px] text-slate-steel italic px-3 py-2">No phases yet</div>
    );
  }

  const nodeById = new Map(l.nodes.map((n) => [n.id, n]));

  return (
    <div className="bg-carbon border border-charcoal rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-subtle bg-abyss/50">
        <span className="text-[10px] font-mono text-slate-steel tracking-[0.18em]">PIPELINE · DAG</span>
        <div className="flex-1" />
        <LegendDot color="var(--color-emerald-signal)" label={`${doneCount} done`} />
        {runningCount > 0 && <LegendDot color="var(--color-emerald-signal)" glow label={`${runningCount} live`} />}
        {pendingCount > 0 && <LegendDot color="#2a2d33" label={`${pendingCount} pending`} />}
        {failedCount > 0 && <LegendDot color="var(--color-danger)" label={`${failedCount} failed`} />}
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
            <marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#00d99288" />
            </marker>
            <marker id="dag-arrow-dim" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#2a2d33" />
            </marker>
            <marker id="dag-arrow-loop" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#ffba0088" />
            </marker>
          </defs>

          {/* Edges — top-to-bottom flow: from bottom of `from` → top of `to` */}
          {l.edges.map((e, i) => {
            const from = nodeById.get(e.fromId);
            const to = nodeById.get(e.toId);
            if (!from || !to) return null;
            const x1 = from.x + from.w / 2;
            const y1 = from.y + from.h;
            const x2 = to.x + to.w / 2;
            const y2 = to.y;

            const stageSpan = to.stage - from.stage;
            let d: string;

            if (stageSpan > 1) {
              // Multi-stage edge: route around the right-side bus lane so we
              // don't slice through intermediate-stage nodes.
              const busX = l.busX;
              d = `M ${x1} ${y1} C ${x1} ${y1 + 18}, ${busX} ${y1 + 18}, ${busX} ${y1 + 36} L ${busX} ${y2 - 36} C ${busX} ${y2 - 18}, ${x2} ${y2 - 18}, ${x2} ${y2}`;
            } else if (e.style === "loop") {
              // Loop-back (re-critique): arch to the LEFT of the node column
              const archX = Math.min(from.x, to.x) - 16;
              const midY = (y1 + y2) / 2;
              d = `M ${x1} ${y1} C ${archX} ${midY}, ${archX} ${midY}, ${x2} ${y2}`;
            } else {
              // Normal adjacent-stage edge: smooth vertical bezier
              const dy = Math.max(18, (y2 - y1) * 0.55);
              d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
            }

            const stroke = e.style === "loop" ? "#ffba0088" : e.highlight ? "#00d99288" : "#2a2d33";
            const marker = e.style === "loop" ? "url(#dag-arrow-loop)" : e.highlight ? "url(#dag-arrow)" : "url(#dag-arrow-dim)";
            const dash = e.style === "loop" ? "2 3" : !e.highlight ? "3 3" : undefined;
            return (
              <path
                key={i}
                d={d}
                stroke={stroke}
                strokeWidth={e.highlight ? 1.25 : 1}
                fill="none"
                markerEnd={marker}
                strokeDasharray={dash}
                opacity={e.style === "loop" ? 0.7 : 1}
              />
            );
          })}

          {/* Nodes — foreignObject lets the browser wrap CJK + Latin natively */}
          {l.nodes.map((n) => {
            const t = nodeTheme(n.status);
            const statusText =
              n.duration !== undefined
                ? `${n.duration.toFixed(1)}s`
                : n.status === "running"
                ? "running"
                : n.status === "pending"
                ? "pending"
                : n.status === "failed"
                ? "failed"
                : "";
            return (
              <g key={n.id}>
                <title>{n.label}</title>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx="5"
                  fill={t.fill}
                  stroke={t.stroke}
                  strokeWidth={n.status === "running" ? 1.5 : 1}
                />
                {n.status === "running" && (
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx="5"
                    fill="none"
                    stroke="#00d992"
                    strokeWidth="2"
                    opacity="0.25"
                  >
                    <animate attributeName="opacity" values="0.05;0.35;0.05" dur="1.8s" repeatCount="indefinite" />
                  </rect>
                )}
                {/* Label — HTML inside SVG for native wrapping */}
                <foreignObject
                  x={n.x + NODE_PAD_X}
                  y={n.y + NODE_PAD_TOP}
                  width={n.w - NODE_PAD_X * 2}
                  height={n.h - NODE_PAD_TOP - STATUS_LINE_H}
                >
                  <div
                    style={{
                      fontSize: `${TEXT_FS}px`,
                      lineHeight: `${LINE_H}px`,
                      color: t.text,
                      fontWeight: n.status === "running" ? 600 : 500,
                      overflow: "hidden",
                      wordBreak: "break-word",
                      overflowWrap: "anywhere",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {n.label}
                  </div>
                </foreignObject>
                {/* Status line */}
                <text
                  x={n.x + NODE_PAD_X}
                  y={n.y + n.h - 6}
                  fontSize="9"
                  fill={t.dim}
                  fontFamily="var(--font-mono)"
                  letterSpacing="0.06em"
                >
                  {statusIcon(n.status)} {statusText}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function LegendDot({ color, label, glow }: { color: string; label: string; glow?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[9px] font-mono text-slate-steel tracking-[0.08em]">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color, boxShadow: glow ? `0 0 6px ${color}` : undefined }}
      />
      {label.toUpperCase()}
    </span>
  );
}
