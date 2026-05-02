import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router";

interface KnowledgeEntry {
  id: number;
  taskId: string;
  topic: string;
  summary: string;
  sources: string[];
  createdAt: number;
}

interface RelatedEntry {
  id: number;
  topic: string;
  taskId: string;
  score: number;
}

interface EmbedSettingsResponse {
  embedding?: { provider?: string; model?: string; dimensions?: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildHeatmap(entries: KnowledgeEntry[]): { day: number; count: number; date: Date }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const cells: { day: number; count: number; date: Date }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = startOfToday - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const count = entries.filter((e) => e.createdAt >= dayStart && e.createdAt < dayEnd).length;
    cells.push({ day: 29 - i, count, date: new Date(dayStart) });
  }
  return cells;
}

function intensity(count: number, max: number): number {
  if (count === 0) return 0;
  if (max === 0) return 0;
  return Math.min(1, 0.18 + (count / max) * 0.82);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const day = Math.floor(diff / DAY_MS);
  if (day < 1) return "today";
  if (day === 1) return "1d ago";
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function truncateCJKAware(s: string, max: number): string {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = /[一-鿿぀-ヿ]/.test(ch) ? 2 : 1;
    if (w + cw > max) return out + "…";
    w += cw;
    out += ch;
  }
  return out;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || null;
  }
}

export function Knowledge() {
  const navigate = useNavigate();
  const { entryId } = useParams<{ entryId?: string }>();
  const selectedId = entryId ? Number(entryId) : null;

  const [allEntries, setAllEntries] = useState<KnowledgeEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<KnowledgeEntry[]>([]);
  const [query, setQuery] = useState("");
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function fetchEntries(q?: string) {
    setLoading(true);
    const url = q ? `/api/knowledge?q=${encodeURIComponent(q)}` : "/api/knowledge";
    fetch(url)
      .then((r) => r.json())
      .then((data: KnowledgeEntry[]) => {
        setFilteredEntries(data);
        if (!q) setAllEntries(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchEntries();
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchEntries(query || undefined);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Active filter pipeline: server-side text search → client-side collection filter
  const visibleEntries = useMemo(() => {
    if (!activeCollection) return filteredEntries;
    return filteredEntries.filter((e) => e.taskId === activeCollection);
  }, [filteredEntries, activeCollection]);

  async function handleDelete(id: number) {
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    setFilteredEntries((prev) => prev.filter((e) => e.id !== id));
    setAllEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) navigate("/knowledge");
  }

  // Selected entry — must come from allEntries so it stays accessible even
  // when a search filters it out of filteredEntries.
  const selectedEntry = selectedId
    ? allEntries.find((e) => e.id === selectedId) ??
      filteredEntries.find((e) => e.id === selectedId) ??
      null
    : null;

  // Stats for sidebar
  const heatmap = useMemo(() => buildHeatmap(allEntries), [allEntries]);
  const heatmapMax = useMemo(() => heatmap.reduce((m, c) => Math.max(m, c.count), 0), [heatmap]);
  const todayCount = heatmap.length > 0 ? heatmap[heatmap.length - 1].count : 0;
  const totalSources = useMemo(
    () => allEntries.reduce((sum, e) => sum + (e.sources?.length ?? 0), 0),
    [allEntries],
  );

  // "Tags" derived from URL hosts of sources (most common N)
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEntries) {
      for (const src of e.sources ?? []) {
        const host = hostFromUrl(src);
        if (!host) continue;
        const key = host.split(".").slice(-2, -1)[0] ?? host;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [allEntries]);

  // "Collections" = group by parent task. Show task topic (use first entry of
  // each task as a representative).
  const collections = useMemo(() => {
    const byTask = new Map<string, { taskId: string; sample: string; count: number }>();
    for (const e of allEntries) {
      const cur = byTask.get(e.taskId);
      if (cur) cur.count += 1;
      else byTask.set(e.taskId, { taskId: e.taskId, sample: e.topic, count: 1 });
    }
    return Array.from(byTask.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }, [allEntries]);

  return (
    <div className="flex-1 grid grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr] overflow-hidden relative z-[1]">
      <KnowledgeTreeSidebar
        totalEntries={allEntries.length}
        query={query}
        onQuery={setQuery}
        tags={tags}
        collections={collections}
        activeCollection={activeCollection}
        onSelectCollection={setActiveCollection}
      />

      {/* Right side: split when an entry is selected */}
      {selectedEntry ? (
        <div className="grid grid-cols-[1fr_400px] overflow-hidden">
          <KnowledgeMain
            allEntries={allEntries}
            visibleEntries={visibleEntries}
            heatmap={heatmap}
            heatmapMax={heatmapMax}
            todayCount={todayCount}
            totalSources={totalSources}
            loading={loading}
            query={query}
            activeCollection={activeCollection}
            selectedId={selectedId}
            onClickEntry={(id) => navigate(`/knowledge/${id}`)}
            onDelete={handleDelete}
            compact
          />
          <KnowledgeRightPanel
            entry={selectedEntry}
            onClose={() => navigate("/knowledge")}
            onOpenRelated={(id) => navigate(`/knowledge/${id}`)}
          />
        </div>
      ) : (
        <KnowledgeMain
          allEntries={allEntries}
          visibleEntries={visibleEntries}
          heatmap={heatmap}
          heatmapMax={heatmapMax}
          todayCount={todayCount}
          totalSources={totalSources}
          loading={loading}
          query={query}
          activeCollection={activeCollection}
          selectedId={selectedId}
          onClickEntry={(id) => navigate(`/knowledge/${id}`)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree sidebar — INDEX header + search + tags + collections
// ---------------------------------------------------------------------------
function KnowledgeTreeSidebar({
  totalEntries,
  query,
  onQuery,
  tags,
  collections,
  activeCollection,
  onSelectCollection,
}: {
  totalEntries: number;
  query: string;
  onQuery: (q: string) => void;
  tags: [string, number][];
  collections: { taskId: string; sample: string; count: number }[];
  activeCollection: string | null;
  onSelectCollection: (id: string | null) => void;
}) {
  return (
    <aside className="border-r border-charcoal bg-carbon px-5 py-5 overflow-y-auto relative z-[2] flex flex-col gap-4">
      <div className="text-[11px] text-slate-steel font-mono tracking-[0.22em]">
        INDEX · {totalEntries} ENTRIES
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="search index…"
          className="w-full bg-abyss border border-charcoal rounded-md pl-8 pr-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50"
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-steel"
          width="14" height="14" viewBox="0 0 16 16" fill="none"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Tags */}
      <div>
        <div className="text-[10px] text-slate-steel font-mono tracking-[0.18em] mb-2">
          TAGS · {tags.length}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 ? (
            <span className="text-[11px] text-slate-steel/50">No tags yet</span>
          ) : (
            tags.map(([tag, n]) => {
              const active = query.toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag}
                  onClick={() => onQuery(active ? "" : tag)}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
                    active
                      ? "bg-emerald-dim border-emerald-signal/50 text-emerald-signal"
                      : "bg-carbon-hover border-charcoal text-slate-steel hover:text-parchment"
                  }`}
                  title={`${tag} · ${n} sources`}
                >
                  #{tag} <span className="text-slate-steel/60">{n}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Collections */}
      <div className="flex-1 min-h-0">
        <div className="text-[10px] text-slate-steel font-mono tracking-[0.18em] mb-2 flex items-center justify-between">
          <span>COLLECTIONS · {collections.length}</span>
          {activeCollection && (
            <button
              onClick={() => onSelectCollection(null)}
              className="text-emerald-signal hover:underline normal-case tracking-normal"
            >
              clear
            </button>
          )}
        </div>
        <div className="space-y-0.5 overflow-y-auto">
          {collections.length === 0 ? (
            <span className="text-[11px] text-slate-steel/50">No collections</span>
          ) : (
            collections.map((c) => {
              const active = activeCollection === c.taskId;
              const label = truncateCJKAware(c.sample, 28);
              return (
                <button
                  key={c.taskId}
                  onClick={() => onSelectCollection(active ? null : c.taskId)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-[12px] border-l-2 transition-colors ${
                    active
                      ? "bg-emerald-dim text-emerald-signal border-emerald-signal"
                      : "text-parchment hover:bg-carbon-hover border-transparent"
                  }`}
                  title={c.sample}
                >
                  <span className="text-slate-steel/60 font-mono text-[10px] w-3 shrink-0">
                    {active ? "▾" : "▸"}
                  </span>
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-[10px] font-mono text-slate-steel/60 shrink-0">
                    {c.count}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main content — header + heatmap + entries grid
// ---------------------------------------------------------------------------
function KnowledgeMain({
  allEntries,
  visibleEntries,
  heatmap,
  heatmapMax,
  todayCount,
  totalSources,
  loading,
  query,
  activeCollection,
  selectedId,
  onClickEntry,
  onDelete,
  compact,
}: {
  allEntries: KnowledgeEntry[];
  visibleEntries: KnowledgeEntry[];
  heatmap: { day: number; count: number; date: Date }[];
  heatmapMax: number;
  todayCount: number;
  totalSources: number;
  loading: boolean;
  query: string;
  activeCollection: string | null;
  selectedId: number | null;
  onClickEntry: (id: number) => void;
  onDelete: (id: number) => void;
  compact?: boolean;
}) {
  return (
    <div className="overflow-y-auto px-7 py-6">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-5">
        <div>
          <div className="text-[11px] text-slate-steel font-mono tracking-[0.2em] uppercase">
            Knowledge / index
          </div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] leading-[1.05] mt-1 text-snow">
            {allEntries.length} entries
            <span className="text-emerald-signal"> · {totalSources} sources indexed</span>
          </h1>
        </div>
      </div>

      {/* Heatmap strip */}
      {allEntries.length > 0 && (
        <div className="px-[18px] py-[14px] border border-charcoal rounded-lg bg-carbon mb-5">
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.2em] mb-2.5">
            INGEST ACTIVITY · LAST 30 DAYS
          </div>
          <div className="flex gap-[3px]">
            {heatmap.map((cell) => {
              const v = intensity(cell.count, heatmapMax);
              const bg =
                v === 0
                  ? "var(--color-charcoal)"
                  : `color-mix(in srgb, var(--color-emerald-signal) ${Math.round(v * 100)}%, transparent)`;
              return (
                <div
                  key={cell.day}
                  className="flex-1 h-8 rounded-sm"
                  style={{ background: bg }}
                  title={`${cell.date.toLocaleDateString()} · ${cell.count} entries`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-1.5 text-[9px] text-slate-steel font-mono">
            <span>
              {heatmap[0]?.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
            <span>TODAY · {todayCount} new</span>
          </div>
        </div>
      )}

      {/* Result count line */}
      <div className="text-[11px] text-slate-steel mb-3 font-mono tracking-wider">
        {loading
          ? "SEARCHING…"
          : query
            ? `${visibleEntries.length} matches for "${query}"`
            : activeCollection
              ? `${visibleEntries.length} entries in collection`
              : `${visibleEntries.length} ENTRIES`}
      </div>

      {/* Entries */}
      {visibleEntries.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-slate-steel/60">
          {query
            ? "No matching entries"
            : activeCollection
              ? "No entries in this collection"
              : "No knowledge yet."}
        </div>
      )}

      <div className={`grid ${compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"} gap-3`}>
        {visibleEntries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedId}
            onOpen={onClickEntry}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------
function EntryCard({
  entry,
  selected,
  onOpen,
  onDelete,
}: {
  entry: KnowledgeEntry;
  selected?: boolean;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const sourceCount = entry.sources?.length ?? 0;
  const borderClass = selected
    ? "border-emerald-signal/60 border-l-2 border-l-emerald-signal bg-carbon-hover"
    : "border-charcoal hover:border-charcoal-light bg-carbon";

  return (
    <div
      onClick={() => onOpen(entry.id)}
      className={`group relative px-[18px] py-4 rounded-lg border ${borderClass} transition-colors overflow-hidden cursor-pointer`}
    >
      {selected && (
        <span className="absolute top-2 right-3 text-[9px] text-emerald-signal font-mono tracking-[0.2em]">
          ● PINNED
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-medium text-snow leading-[1.35] tracking-[-0.005em] flex-1 pr-12">
          {entry.topic}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
          className="text-slate-steel/60 hover:text-danger text-xs p-1 -mt-1 -mr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete"
        >
          ✕
        </button>
      </div>

      <div className="text-[12px] text-parchment leading-relaxed mt-1.5 line-clamp-3">
        {entry.summary}
      </div>

      <div className="flex items-center gap-2 mt-3 text-[10px] font-mono tracking-[0.08em] text-slate-steel">
        <span className="text-slate-steel/80">{entry.taskId.slice(0, 12)}</span>
        <span>·</span>
        <span>{sourceCount} sources</span>
        <span>·</span>
        <span>{formatRelative(entry.createdAt)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel — selected entry detail + relation graph + embed health
// ---------------------------------------------------------------------------
function KnowledgeRightPanel({
  entry,
  onClose,
  onOpenRelated,
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
  onOpenRelated: (id: number) => void;
}) {
  const [related, setRelated] = useState<RelatedEntry[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setLoadingRelated(true);
    setRelated([]);
    fetch(`/api/knowledge/${entry.id}/related?limit=6`)
      .then((r) => r.json())
      .then((data: RelatedEntry[]) => setRelated(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingRelated(false));
  }, [entry.id]);

  return (
    <aside className="border-l border-charcoal bg-carbon flex flex-col overflow-hidden relative z-[2]">
      {/* Detail header */}
      <div className="px-5 py-4 border-b border-charcoal">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-1">
              KNOWLEDGE ENTRY
            </div>
            <h2 className="text-[15px] font-semibold text-snow leading-snug">
              {entry.topic}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-steel hover:text-snow text-base shrink-0"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable detail body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="text-[13px] text-parchment leading-relaxed whitespace-pre-wrap">
          {entry.summary}
        </div>

        {entry.sources?.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-2">
              SOURCES · {entry.sources.length}
            </div>
            <div className="space-y-1">
              {entry.sources.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11px] text-emerald-signal font-mono hover:underline truncate"
                  title={url}
                >
                  ↗ {url.replace(/^https?:\/\//, "")}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-charcoal flex items-center gap-2 text-[10px] font-mono text-slate-steel tracking-[0.08em]">
          <span>{entry.taskId.slice(0, 16)}…</span>
          <span>·</span>
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {/* Relation graph */}
      <div className="border-t border-charcoal">
        <div className="px-5 pt-3 pb-2">
          <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-1">
            RELATION GRAPH
          </div>
          <div className="text-[12px] text-snow font-medium tracking-[-0.01em] truncate">
            neighbors · {related.length}
          </div>
        </div>
        <div className="relative px-3 pb-3" style={{ height: 280 }}>
          {loadingRelated ? (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-steel/60 font-mono">
              computing…
            </div>
          ) : related.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-center text-[11px] text-slate-steel/60 px-6">
              No semantic neighbors found.
            </div>
          ) : (
            <RelationGraph
              centerLabel={entry.topic}
              neighbors={related}
              onClickNeighbor={onOpenRelated}
            />
          )}
        </div>
      </div>

      <EmbedHealth />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Relation graph — small dots + outward-anchored label pills
// ---------------------------------------------------------------------------
function RelationGraph({
  centerLabel,
  neighbors,
  onClickNeighbor,
}: {
  centerLabel: string;
  neighbors: RelatedEntry[];
  onClickNeighbor: (id: number) => void;
}) {
  const W = 380;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const dotR = 5;
  const lineRadius = 84;
  const labelRadius = 94;
  const centerR = 30;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      className="overflow-visible"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="centerGlow">
          <stop offset="0%" stopColor="var(--color-emerald-signal)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--color-emerald-signal)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Edges */}
      {neighbors.map((n, i) => {
        const angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * lineRadius;
        const y = cy + Math.sin(angle) * lineRadius;
        const strong = n.score >= 0.4;
        return (
          <line
            key={`e-${n.id}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke={strong ? "var(--color-emerald-signal)" : "var(--color-charcoal-light)"}
            strokeWidth={strong ? 1.2 : 0.8}
            strokeDasharray={strong ? "none" : "3 4"}
            opacity={strong ? 0.7 : 0.45}
          />
        );
      })}

      {/* Center */}
      <circle cx={cx} cy={cy} r={centerR + 20} fill="url(#centerGlow)" />
      <circle
        cx={cx}
        cy={cy}
        r={centerR + 7}
        fill="none"
        stroke="var(--color-emerald-signal)"
        strokeWidth="0.8"
        opacity="0.3"
      />
      <circle
        cx={cx}
        cy={cy}
        r={centerR}
        fill="rgba(0,217,146,0.14)"
        stroke="var(--color-emerald-signal)"
        strokeWidth="1.3"
      />
      <foreignObject x={cx - centerR + 4} y={cy - centerR + 4} width={centerR * 2 - 8} height={centerR * 2 - 8}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-emerald-signal)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAlign: "center",
            lineHeight: 1.18,
            wordBreak: "break-word",
            padding: "0 2px",
          }}
          title={centerLabel}
        >
          {truncateCJKAware(centerLabel, 14)}
        </div>
      </foreignObject>

      {/* Satellites */}
      {neighbors.map((n, i) => {
        const angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const dotX = cx + dx * lineRadius;
        const dotY = cy + dy * lineRadius;
        const labelX = cx + dx * labelRadius;
        const labelY = cy + dy * labelRadius;
        const strong = n.score >= 0.4;
        const color = strong ? "var(--color-emerald-signal)" : "var(--color-slate-steel)";

        const anchorRight = dx < -0.1;
        const anchorLeft = dx > 0.1;
        const pillW = 130;
        const pillH = 34;
        const pillX = anchorRight
          ? labelX - pillW
          : anchorLeft
            ? labelX
            : labelX - pillW / 2;
        const pillY = labelY - pillH / 2;

        const truncated = truncateCJKAware(n.topic, 26);
        const scoreLabel = n.score.toFixed(2);

        return (
          <g
            key={`n-${n.id}`}
            onClick={() => onClickNeighbor(n.id)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={dotX}
              cy={dotY}
              r={dotR}
              fill={strong ? "var(--color-emerald-signal)" : "var(--color-carbon-hover)"}
              stroke={color}
              strokeWidth="1.2"
            />
            <foreignObject x={pillX} y={pillY} width={pillW} height={pillH}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: anchorRight ? "flex-end" : anchorLeft ? "flex-start" : "center",
                  color,
                  padding: "2px 6px",
                  textAlign: anchorRight ? "right" : anchorLeft ? "left" : "center",
                }}
                title={`${n.topic} · score ${scoreLabel}`}
              >
                <span
                  style={{
                    fontSize: 11,
                    lineHeight: 1.2,
                    color: "var(--color-snow)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {truncated}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.08em",
                    marginTop: 2,
                  }}
                >
                  ◉ {scoreLabel}
                </span>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Embed health
// ---------------------------------------------------------------------------
function EmbedHealth() {
  const [info, setInfo] = useState<EmbedSettingsResponse | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: EmbedSettingsResponse) => setInfo(d))
      .catch(() => {});
  }, []);

  const provider = info?.embedding?.provider ?? "—";
  const model = info?.embedding?.model || "—";
  const dim = info?.embedding?.dimensions ?? "—";

  const rows: { label: string; value: string; accent?: boolean }[] = [
    { label: "provider", value: provider, accent: provider !== "—" },
    { label: "model", value: model },
    { label: "dimensions", value: String(dim) },
  ];

  return (
    <div className="border-t border-charcoal px-5 py-3.5">
      <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-2">
        EMBED HEALTH
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex justify-between py-1 text-[11px] font-mono"
        >
          <span className="text-slate-steel/80">{r.label}</span>
          <span
            className={r.accent ? "text-emerald-signal" : "text-parchment"}
            title={r.value}
          >
            {r.value.length > 28 ? r.value.slice(0, 28) + "…" : r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
