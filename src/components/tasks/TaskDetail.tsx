import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useTaskStore } from "../../store/tasks";
import { StatusBadge } from "../common/Badge";
import { Tooltip } from "../common/Tooltip";
import { UsageTooltip } from "../common/UsageTooltip";
import { PipelineView } from "./PipelineView";
import { ReportDiff } from "./ReportDiff";
import type { TurnDetail } from "../../types";

interface ChainItem {
  id: number;
  parentTaskId: string;
  childTaskId: string | null;
  goalTemplate: string;
  contextMode: string;
  status: string;
  createdAt: number;
}

const mdComponents = {
  a: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
};

export function TaskDetail() {
  const navigate = useNavigate();
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const task = useTaskStore((s) => s.activeTaskDetail);
  const loadError = useTaskStore((s) => s.activeTaskError);
  const streamingText = useTaskStore((s) => s.streamingText);
  const streamingPhaseKind = useTaskStore((s) => s.streamingPhaseKind);
  const streamingByPhase = useTaskStore((s) => s.streamingByPhase);
  const storeCloseTask = useTaskStore((s) => s.closeTask);
  const followup = useTaskStore((s) => s.followup);
  const retry = useTaskStore((s) => s.retry);
  const cancel = useTaskStore((s) => s.cancel);
  const togglePin = useTaskStore((s) => s.togglePin);
  const setTags = useTaskStore((s) => s.setTags);

  const closeTask = useCallback(() => {
    storeCloseTask();
    navigate("/");
  }, [storeCloseTask, navigate]);

  const [followupMessage, setFollowupMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingTurnSeq, setViewingTurnSeq] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [chainGoal, setChainGoal] = useState("");
  const [chainMode, setChainMode] = useState<"quick" | "standard" | "deep">("quick");
  const [chainSending, setChainSending] = useState(false);
  const [chains, setChains] = useState<ChainItem[]>([]);

  useEffect(() => {
    setFollowupMessage("");
    setError(null);
    setViewingTurnSeq(null);
    setCopied(false);
  }, [activeTaskId]);

  // Fetch chains whenever the active task or its status changes
  useEffect(() => {
    if (!activeTaskId) { setChains([]); return; }
    let cancelled = false;
    async function loadChains() {
      try {
        const res = await fetch(`/api/tasks/${activeTaskId}/chains`);
        if (!res.ok) return;
        const data = (await res.json()) as ChainItem[];
        if (!cancelled) setChains(data);
      } catch { /* ignore */ }
    }
    loadChains();
    // Poll while task is running or a chain is still pending
    const interval = setInterval(loadChains, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTaskId, task?.status]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeTask();
    }
    if (activeTaskId) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [activeTaskId, closeTask]);

  const handleCopy = useCallback(() => {
    if (!task?.result) return;
    navigator.clipboard.writeText(task.result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [task?.result]);

  const handleDownload = useCallback(() => {
    if (!task?.result) return;
    const blob = new Blob([task.result], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = task.goal.slice(0, 40).replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-");
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [task?.result, task?.goal]);

  if (!activeTaskId) return null;

  if (!task) {
    return (
      <>
        <div onClick={closeTask} className="fixed inset-0 bg-black/60 z-40 animate-fade-in" />
        <div className="fixed top-0 right-0 bottom-0 w-[min(960px,90vw)] bg-abyss border-l border-charcoal z-50 flex items-center justify-center animate-slide-in">
          {loadError ? (
            <div className="text-center max-w-sm px-6">
              <div className="text-danger text-sm font-medium mb-2">Task not found</div>
              <div className="text-xs text-slate-steel mb-4 font-mono">{loadError}</div>
              <button onClick={closeTask} className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs text-parchment hover:border-charcoal-light">Close</button>
            </div>
          ) : (
            <div className="text-sm text-slate-steel animate-pulse">Loading...</div>
          )}
        </div>
      </>
    );
  }

  const latestTurn = task.turns[task.turns.length - 1];
  const viewingTurn = viewingTurnSeq !== null
    ? task.turns.find((t) => t.seq === viewingTurnSeq)
    : latestTurn;
  const isLatestTurn = viewingTurn?.seq === latestTurn?.seq;
  const canFollowup = task.status !== "running";

  const totalDuration = task.completedAt && task.createdAt
    ? ((task.completedAt - task.createdAt) / 1000).toFixed(1)
    : null;

  async function handleChain() {
    const g = chainGoal.trim();
    if (!g || chainSending) return;
    setChainSending(true);
    try {
      await fetch(`/api/tasks/${activeTaskId}/chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: g, mode: chainMode }),
      });
      setChainGoal("");
      // Refresh list + chains to show the new chain entry
      useTaskStore.getState().refreshList();
      try {
        const res = await fetch(`/api/tasks/${activeTaskId}/chains`);
        if (res.ok) setChains(await res.json());
      } catch { /* ignore */ }
    } catch {
      /* ignore */
    } finally {
      setChainSending(false);
    }
  }

  async function handleFollowup(e: React.FormEvent) {
    e.preventDefault();
    const msg = followupMessage.trim();
    if (!msg || sending) return;
    setSending(true);
    setError(null);
    try {
      await followup(activeTaskId!, msg);
      setFollowupMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div onClick={closeTask} className="fixed inset-0 bg-black/60 z-40 animate-fade-in" />
      <div className="fixed top-0 right-0 bottom-0 w-[min(1100px,92vw)] bg-abyss border-l border-charcoal z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-charcoal shrink-0">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <StatusBadge status={task.status} />
              {task.turnCount > 1 && (
                <span className="text-[11px] font-mono text-emerald-signal">v{task.turnCount}</span>
              )}
              {totalDuration && (
                <span className="text-[11px] font-mono text-slate-steel">{totalDuration}s</span>
              )}
              {(task.usage?.input_tokens !== undefined || task.usage?.output_tokens !== undefined) && (
                <Tooltip content={<UsageTooltip usage={task.usage} />}>
                  <span className="text-[11px] font-mono text-slate-steel cursor-help">
                    {(task.usage.input_tokens ?? 0).toLocaleString()} ↑ / {(task.usage.output_tokens ?? 0).toLocaleString()} ↓
                  </span>
                </Tooltip>
              )}
              <span className="text-[10px] font-mono text-slate-steel/50 px-1.5 py-0.5 rounded bg-carbon border border-charcoal-subtle">{task.mode}</span>
            </div>

            {/* Actions + close — aligned together */}
            <div className="flex items-center gap-2 shrink-0">
              {task.result && (
                <>
                  <button onClick={handleCopy} className="px-2.5 py-1 text-[11px] font-medium bg-carbon border border-charcoal rounded-md text-parchment hover:border-charcoal-light transition-colors">
                    {copied ? "Copied" : "Copy MD"}
                  </button>
                  <button onClick={handleDownload} className="px-2.5 py-1 text-[11px] font-medium bg-carbon border border-charcoal rounded-md text-parchment hover:border-charcoal-light transition-colors">
                    .md ↓
                  </button>
                </>
              )}
              {task.status === "failed" && (
                <button onClick={() => retry(activeTaskId!)} className="px-2.5 py-1 text-[11px] font-medium bg-carbon border border-charcoal rounded-md text-warning hover:border-warning/30 transition-colors">
                  Retry
                </button>
              )}
              {task.status === "running" && (
                <button onClick={() => cancel(activeTaskId!)} className="px-2.5 py-1 text-[11px] font-medium bg-danger-dim border border-danger/30 rounded-md text-danger hover:border-danger/50 transition-colors">
                  Cancel
                </button>
              )}
              <button onClick={closeTask} className="text-slate-steel hover:text-snow p-1 text-lg" title="Close (Esc)">✕</button>
            </div>
          </div>

          <h2 className="text-lg font-semibold text-snow line-clamp-2 font-[family-name:var(--font-heading)] tracking-tight">
            {task.goal}
          </h2>
            {/* Tags + pin */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => togglePin(activeTaskId!)}
                className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                  task.pinned
                    ? "text-warning border-warning/30 bg-warning-dim"
                    : "text-slate-steel border-charcoal hover:text-warning hover:border-warning/30"
                }`}
              >
                {task.pinned ? "★ Pinned" : "☆ Pin"}
              </button>
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-pill bg-info-dim text-info border border-info/20"
                >
                  #{tag}
                  <button
                    onClick={() =>
                      setTags(
                        activeTaskId!,
                        task.tags.filter((t) => t !== tag)
                      )
                    }
                    className="hover:text-danger ml-0.5 text-[10px]"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = tagInput.trim().replace(/^#/, "");
                  if (t && !task.tags.includes(t)) {
                    setTags(activeTaskId!, [...task.tags, t]);
                  }
                  setTagInput("");
                }}
                className="inline-flex"
              >
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="+ tag"
                  className="w-16 bg-transparent border-b border-charcoal text-[11px] text-parchment placeholder:text-slate-steel/50 focus:outline-none focus:border-emerald-signal/50 px-0.5"
                />
              </form>
            </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            {/* Report column */}
            <div className="min-w-0">
              {task.turns.length > 1 && (
                <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                  <span className="text-[11px] text-slate-steel uppercase tracking-wider mr-1">Version</span>
                  {task.turns.map((turn) => (
                    <button
                      key={turn.seq}
                      onClick={() => setViewingTurnSeq(turn.seq)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                        viewingTurn?.seq === turn.seq
                          ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                          : "bg-carbon border-charcoal text-parchment hover:border-charcoal-light"
                      }`}
                      title={turn.userMessage}
                    >
                      v{turn.seq + 1}
                    </button>
                  ))}
                  {!isLatestTurn && (
                    <button onClick={() => setViewingTurnSeq(null)} className="ml-2 text-[11px] text-slate-steel hover:text-parchment">← latest</button>
                  )}
                </div>
              )}

              {viewingTurn && (
                <ReportView
                  turn={viewingTurn}
                  isLatest={isLatestTurn}
                  streamingText={isLatestTurn ? streamingText : ""}
                  previousReport={
                    viewingTurn && viewingTurn.seq > 0
                      ? [...task.turns].reverse().find((t) => t.seq < viewingTurn.seq && t.report)?.report
                      : undefined
                  }
                />
              )}

              {isLatestTurn && (
                <form onSubmit={handleFollowup} className="mt-8 bg-carbon border border-charcoal rounded-lg p-4">
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">Refine this report</div>
                  <textarea
                    value={followupMessage}
                    onChange={(e) => setFollowupMessage(e.target.value)}
                    placeholder="Expand section 2 with examples. Add a comparison table..."
                    rows={3}
                    disabled={!canFollowup || sending}
                    className="w-full bg-abyss border border-charcoal rounded-md px-3 py-2.5 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50 resize-none disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleFollowup(e);
                    }}
                  />
                  {error && <div className="mt-2 text-xs text-danger">{error}</div>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-slate-steel font-mono">
                      {canFollowup ? "Ctrl+Enter · runs full pipeline" : "Pipeline running..."}
                    </span>
                    <button type="submit" disabled={!followupMessage.trim() || sending || !canFollowup} className="px-4 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {sending ? "Submitting..." : "Refine"}
                    </button>
                  </div>
                </form>
              )}
              {/* Chains list */}
              {chains.length > 0 && (
                <div className="mt-4 bg-carbon border border-charcoal rounded-lg p-4">
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">
                    Chains ({chains.length})
                  </div>
                  <div className="space-y-1.5">
                    {chains.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-[12px]">
                        <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          c.status === "triggered"
                            ? "bg-emerald-signal/10 text-emerald-signal border border-emerald-signal/20"
                            : "bg-carbon-hover text-slate-steel border border-charcoal"
                        }`}>
                          {c.status}
                        </span>
                        <span className="flex-1 text-parchment truncate" title={c.goalTemplate}>{c.goalTemplate}</span>
                        {c.childTaskId && (
                          <button
                            onClick={() => {
                              useTaskStore.getState().openTask(c.childTaskId!);
                              navigate(`/tasks/${c.childTaskId}`);
                            }}
                            className="text-[10px] text-emerald-signal hover:underline shrink-0"
                          >
                            open →
                          </button>
                        )}
                        {c.status === "pending" && (
                          <button
                            onClick={async () => {
                              await fetch(`/api/chains/${c.id}`, { method: "DELETE" });
                              setChains((cs) => cs.filter((x) => x.id !== c.id));
                            }}
                            className="text-slate-steel hover:text-danger text-xs shrink-0"
                            title="Cancel"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chain next task */}
              {isLatestTurn && canFollowup && task.result && (
                <div className="mt-4 bg-carbon border border-charcoal rounded-lg p-4">
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">
                    Chain next task
                  </div>
                  <div className="text-[11px] text-slate-steel mb-2">
                    Trigger a follow-up task that receives this report as context. Quick mode skips plan+research.
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={chainGoal}
                      onChange={(e) => setChainGoal(e.target.value)}
                      placeholder="Next task goal (e.g. 提取最有用的信息)..."
                      className="flex-1 bg-abyss border border-charcoal rounded-md px-3 py-1.5 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleChain();
                        }
                      }}
                    />
                    <select
                      value={chainMode}
                      onChange={(e) => setChainMode(e.target.value as "quick" | "standard" | "deep")}
                      className="px-2 bg-abyss border border-charcoal rounded-md text-xs text-snow focus:outline-none focus:border-emerald-signal/50 shrink-0"
                      title="Pipeline mode for the child task"
                    >
                      <option value="quick">Quick</option>
                      <option value="standard">Standard</option>
                      <option value="deep">Deep</option>
                    </select>
                    <button
                      onClick={handleChain}
                      disabled={!chainGoal.trim() || chainSending}
                      className="px-3 py-1.5 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 transition-colors shrink-0"
                    >
                      {chainSending ? "..." : "Chain"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-5 min-w-0">
              {task.context && (
                <div>
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">Context</div>
                  <div className="text-[12px] text-parchment bg-carbon border border-charcoal-subtle rounded-md px-3 py-2 font-mono whitespace-pre-wrap max-h-[180px] overflow-y-auto">{task.context}</div>
                </div>
              )}
              {task.toolsets.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">Toolsets</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {task.toolsets.map((ts) => (
                      <span key={ts} className="text-[11px] px-2 py-0.5 bg-carbon border border-charcoal rounded text-parchment font-mono">{ts}</span>
                    ))}
                  </div>
                </div>
              )}
              {viewingTurn && viewingTurn.phases.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-steel uppercase tracking-wider mb-2">Pipeline · v{viewingTurn.seq + 1}</div>
                  <PipelineView phases={viewingTurn.phases} streamingText={streamingText} streamingPhaseKind={streamingPhaseKind} streamingByPhase={streamingByPhase} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Convert LaTeX-style \[...\] and \(...\) to $$...$$ and $...$ so
 * remark-math can pick them up.
 */
function normalizeLatexDelimiters(text: string): string {
  // Block math: \[...\] → $$...$$
  let s = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner}$$`);
  // Inline math: \(...\) → $...$
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);
  return s;
}

/**
 * Strip trailing incomplete markdown syntax so react-markdown doesn't
 * render raw `**`, `` ` ``, `[`, etc. during streaming.
 * Leaves $...$ math delimiters alone.
 */
export function sanitizeStreamingMarkdown(text: string): string {
  let s = text;
  // Remove trailing unclosed fenced code block (``` without matching close)
  const fences = s.match(/```/g);
  if (fences && fences.length % 2 !== 0) {
    const lastFence = s.lastIndexOf("```");
    s = s.slice(0, lastFence);
  }
  // Remove trailing unclosed bold (**): if odd count, strip from last **
  const bolds = s.match(/\*\*/g);
  if (bolds && bolds.length % 2 !== 0) {
    const lastBold = s.lastIndexOf("**");
    s = s.slice(0, lastBold);
  }
  // Remove trailing unclosed italic (*): count single * not part of **
  const withoutBold = s.replace(/\*\*/g, "");
  const singles = withoutBold.match(/\*/g);
  if (singles && singles.length % 2 !== 0) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === "*" && (i === 0 || s[i - 1] !== "*") && (i >= s.length - 1 || s[i + 1] !== "*")) {
        s = s.slice(0, i);
        break;
      }
    }
  }
  // Remove trailing unclosed inline code backtick (but NOT inside $$...$$)
  const withoutMath = s.replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[^$]*?\$/g, "");
  const backticks = withoutMath.match(/`/g);
  if (backticks && backticks.length % 2 !== 0) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === "`" && !isInsideMath(s, i)) {
        s = s.slice(0, i);
        break;
      }
    }
  }
  // Remove trailing unclosed link: `[text` without `](`
  // But not \[ which is a math delimiter
  const lastBracket = s.lastIndexOf("[");
  if (
    lastBracket !== -1 &&
    (lastBracket === 0 || s[lastBracket - 1] !== "\\") &&
    s.indexOf("](", lastBracket) === -1 &&
    s.indexOf("]", lastBracket + 1) === -1
  ) {
    s = s.slice(0, lastBracket);
  }
  // Remove trailing unclosed $$ block math
  const doubleDollars = s.match(/\$\$/g);
  if (doubleDollars && doubleDollars.length % 2 !== 0) {
    s = s.slice(0, s.lastIndexOf("$$"));
  }
  return s;
}

function isInsideMath(text: string, pos: number): boolean {
  // Quick heuristic: count $ before pos
  let dollars = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === "$") dollars++;
  }
  return dollars % 2 !== 0;
}

function ReportView({
  turn,
  isLatest,
  streamingText,
  previousReport,
}: {
  turn: TurnDetail;
  isLatest: boolean;
  streamingText: string;
  previousReport?: string;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const duration = turn.completedAt && turn.createdAt
    ? ((turn.completedAt - turn.createdAt) / 1000).toFixed(1)
    : null;

  const revisePhase = turn.phases.find((p) => p.kind === "revise");
  const draftPhase = turn.phases.find((p) => p.kind === "draft");
  const writePhase = turn.phases.find((p) => p.kind === "write");

  const persistedReport =
    turn.report ||
    revisePhase?.output ||
    writePhase?.output ||
    draftPhase?.output ||
    "";

  const rawDisplay = persistedReport || (isLatest ? streamingText : "");
  const isStreaming = isLatest && !persistedReport && streamingText.length > 0;
  const sanitized = isStreaming ? sanitizeStreamingMarkdown(rawDisplay) : rawDisplay;
  const displayReport = normalizeLatexDelimiters(sanitized);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isStreaming && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isStreaming, displayReport]);

  return (
    <div>
      {turn.seq > 0 && (
        <div className="mb-4 bg-carbon border border-charcoal rounded-md px-4 py-2.5">
          <div className="text-[10px] text-slate-steel uppercase tracking-wider mb-1">Revision request</div>
          <div className="text-[13px] text-parchment whitespace-pre-wrap">{turn.userMessage}</div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="text-xs font-medium text-slate-steel uppercase tracking-wider">
          {turn.seq === 0 ? "Report" : `Version ${turn.seq + 1}`}
          {!isLatest && <span className="ml-2 text-[10px] text-slate-steel/60 normal-case tracking-normal">(historical)</span>}
          {isStreaming && <span className="ml-2 text-[10px] text-agent-thinking animate-pulse normal-case tracking-normal">streaming...</span>}
        </div>
        <StatusBadge status={turn.status} />
        {duration && <span className="text-[11px] font-mono text-slate-steel">{duration}s</span>}
      </div>

      {turn.status === "running" && !displayReport && (
        <div className="text-sm text-agent-thinking animate-pulse">
          Pipeline running — see sidebar for phase progress.
        </div>
      )}
      {turn.error && (
        <div className="bg-danger-dim border border-danger/20 rounded-md px-4 py-3 text-sm text-danger">{turn.error}</div>
      )}
      {displayReport && (
        <>
          {previousReport && !isStreaming && (
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => setShowDiff((d) => !d)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  showDiff
                    ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                    : "bg-carbon border-charcoal text-slate-steel hover:border-charcoal-light"
                }`}
              >
                {showDiff ? "Hide diff" : "Show diff"}
              </button>
              <span className="text-[10px] text-slate-steel">
                vs v{turn.seq}
              </span>
            </div>
          )}
          {showDiff && previousReport ? (
            <ReportDiff oldText={previousReport} newText={displayReport} />
          ) : (
            <div className="prose-hermes">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
                {displayReport}
              </ReactMarkdown>
              {isStreaming && <span className="inline-block w-2 h-4 bg-emerald-signal/60 animate-pulse ml-0.5" />}
              <div ref={bottomRef} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
