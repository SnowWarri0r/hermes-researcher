import { useState, useEffect, useMemo, useRef } from "react";

interface KnowledgeEntry {
  id: number;
  taskId: string;
  topic: string;
  summary: string;
  sources: string[];
  createdAt: number;
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

export function Knowledge() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [allEntries, setAllEntries] = useState<KnowledgeEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<KnowledgeEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function fetchEntries(q?: string) {
    setLoading(true);
    const url = q ? `/api/knowledge?q=${encodeURIComponent(q)}` : "/api/knowledge";
    fetch(url)
      .then((r) => r.json())
      .then((data: KnowledgeEntry[]) => {
        setEntries(data);
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

  async function handleDelete(id: number) {
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setAllEntries((prev) => prev.filter((e) => e.id !== id));
    setOpenEntry((cur) => (cur && cur.id === id ? null : cur));
  }

  const heatmap = useMemo(() => buildHeatmap(allEntries), [allEntries]);
  const heatmapMax = useMemo(() => heatmap.reduce((m, c) => Math.max(m, c.count), 0), [heatmap]);
  const todayCount = heatmap.length > 0 ? heatmap[heatmap.length - 1].count : 0;
  const totalSources = useMemo(
    () => allEntries.reduce((sum, e) => sum + (e.sources?.length ?? 0), 0),
    [allEntries],
  );

  return (
    <div>
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

      {/* Search */}
      <div className="relative mb-5 max-w-xl">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search index…"
          className="w-full bg-carbon border border-charcoal rounded-md pl-8 pr-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50"
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-steel"
          width="14" height="14" viewBox="0 0 16 16" fill="none"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
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

      {/* Stats */}
      <div className="text-[11px] text-slate-steel mb-3 font-mono tracking-wider">
        {loading
          ? "SEARCHING…"
          : query
            ? `${entries.length} matches for "${query}"`
            : `${entries.length} ENTRIES`}
      </div>

      {/* Entries grid */}
      {entries.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-slate-steel/60">
          {query
            ? "No matching entries"
            : "No knowledge yet. Complete a research task to start building the knowledge base."}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onDelete={handleDelete}
            onOpen={setOpenEntry}
          />
        ))}
      </div>

      {openEntry && <EntryDetailModal entry={openEntry} onClose={() => setOpenEntry(null)} />}
    </div>
  );
}

function EntryCard({
  entry,
  onDelete,
  onOpen,
}: {
  entry: KnowledgeEntry;
  onDelete: (id: number) => void;
  onOpen: (entry: KnowledgeEntry) => void;
}) {
  const sourceCount = entry.sources?.length ?? 0;

  return (
    <div
      onClick={() => onOpen(entry)}
      className="group relative px-[18px] py-4 rounded-lg bg-carbon border border-charcoal hover:border-charcoal-light transition-colors overflow-hidden cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-medium text-snow leading-[1.35] tracking-[-0.005em] flex-1">
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

function EntryDetailModal({
  entry,
  onClose,
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-abyss/70 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-carbon border border-charcoal-light rounded-lg w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="px-6 py-4 border-b border-charcoal flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-1">
              KNOWLEDGE ENTRY
            </div>
            <h2 className="text-lg font-semibold text-snow leading-snug">{entry.topic}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-steel hover:text-snow text-lg shrink-0 -mt-1"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="text-[14px] text-parchment leading-relaxed whitespace-pre-wrap">
            {entry.summary}
          </div>

          {entry.sources?.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-steel font-mono tracking-[0.22em] mb-2">
                SOURCES · {entry.sources.length}
              </div>
              <div className="space-y-1.5">
                {entry.sources.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[12px] text-emerald-signal font-mono hover:underline truncate"
                    title={url}
                  >
                    ↗ {url.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-charcoal flex items-center gap-3 text-[10px] font-mono text-slate-steel tracking-[0.08em]">
            <span>{entry.taskId}</span>
            <span>·</span>
            <span>{new Date(entry.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
