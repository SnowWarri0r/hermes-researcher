import { useState, useEffect, useRef } from "react";

interface KnowledgeEntry {
  id: number;
  taskId: string;
  topic: string;
  summary: string;
  sources: string[];
  createdAt: number;
}

export function Knowledge() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function fetchEntries(q?: string) {
    setLoading(true);
    const url = q ? `/api/knowledge?q=${encodeURIComponent(q)}` : "/api/knowledge";
    fetch(url)
      .then((r) => r.json())
      .then(setEntries)
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
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-snow mb-4 font-[family-name:var(--font-heading)] tracking-tight">
        Knowledge Base
      </h2>
      <div className="text-xs text-slate-steel mb-4">
        Findings extracted from completed research tasks. Automatically searched when planning new tasks.
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search knowledge..."
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

      {/* Stats */}
      <div className="text-[11px] text-slate-steel mb-3">
        {loading ? "Searching..." : `${entries.length} entries${query ? ` matching "${query}"` : ""}`}
      </div>

      {/* Entries */}
      {entries.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-slate-steel/60">
          {query ? "No matching entries" : "No knowledge yet. Complete a research task to start building the knowledge base."}
        </div>
      )}

      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-carbon border border-charcoal rounded-lg px-4 py-3 group hover:border-charcoal-light transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-snow">{entry.topic}</div>
                <div className="text-xs text-parchment mt-1 leading-relaxed">
                  {entry.summary}
                </div>
                {entry.sources.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {entry.sources.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-emerald-signal hover:underline truncate max-w-[200px] font-mono"
                      >
                        {url.replace(/^https?:\/\//, "").slice(0, 40)}
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-slate-steel/60 font-mono">
                    {entry.taskId.slice(0, 12)}
                  </span>
                  <span className="text-[10px] text-slate-steel/60">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                className="text-slate-steel hover:text-danger text-xs p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
