import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { ChatMessage, TaskEvent } from "../../types";
import { useTaskStore } from "../../store/tasks";

function normalizeLatex(text: string): string {
  let s = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner}$$`);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);
  return s;
}

export function ReportChat() {
  const messages = useTaskStore((s) => s.chatMessages);
  const streaming = useTaskStore((s) => s.streamingChatByMessage);
  const streamingEvents = useTaskStore((s) => s.streamingChatEventsByMessage);
  const sendChat = useTaskStore((s) => s.sendChat);
  const clearChat = useTaskStore((s) => s.clearChat);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on message update
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming, collapsed]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendChat(text);
      setInput("");
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear entire chat thread?")) return;
    await clearChat();
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="mt-8 bg-carbon border border-charcoal rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-carbon-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-steel uppercase tracking-wider">
            Chat about this report
          </span>
          {hasMessages && (
            <span className="text-[10px] font-mono text-slate-steel/70">
              ({messages.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasMessages && !collapsed && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="text-[10px] text-slate-steel hover:text-danger px-2 py-0.5"
              title="Clear thread"
            >
              Clear
            </button>
          )}
          <span className="text-slate-steel text-[10px] select-none">
            {collapsed ? "▶" : "▼"}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-charcoal-subtle">
          {hasMessages ? (
            <div
              ref={scrollRef}
              className="max-h-[480px] overflow-y-auto px-4 py-3 space-y-3"
            >
              {messages.map((m) => (
                <ChatBubble
                  key={m.id}
                  message={m}
                  streamingOverride={streaming[m.id]}
                  streamingEvents={streamingEvents[m.id]}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-[12px] text-slate-steel/70">
              Ask anything — I can quote the report or search the web.
            </div>
          )}

          <form
            onSubmit={handleSend}
            className="border-t border-charcoal-subtle px-4 py-3 flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What does section 3 mean? How has this evolved since April?"
              rows={2}
              disabled={sending}
              className="flex-1 bg-abyss border border-charcoal rounded-md px-3 py-2 text-sm text-snow placeholder:text-slate-steel focus:outline-none focus:border-emerald-signal/50 resize-none disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(e);
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="px-3 py-2 bg-carbon border border-charcoal rounded-md text-xs font-medium text-mint hover:border-emerald-signal/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-stretch"
            >
              {sending ? "..." : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  streamingOverride,
  streamingEvents,
}: {
  message: ChatMessage;
  streamingOverride?: string;
  streamingEvents?: TaskEvent[];
}) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "running";
  const displayText =
    isStreaming && streamingOverride !== undefined
      ? streamingOverride
      : message.content;
  const eventsToShow = isStreaming
    ? streamingEvents ?? []
    : message.events ?? [];

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-carbon-hover border border-charcoal rounded-lg px-3 py-2 text-[13px] text-snow whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  // While streaming with no content yet but events arriving → show a "working"
  // preview of the latest event so the user knows something is happening.
  const liveHint = isStreaming && !displayText && eventsToShow.length > 0
    ? describeEvent(eventsToShow[eventsToShow.length - 1])
    : null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-abyss border border-charcoal-subtle rounded-lg px-3 py-2">
        {eventsToShow.length > 0 && (
          <ToolEvents events={eventsToShow} streaming={isStreaming} />
        )}
        {liveHint && (
          <div className="text-[11px] text-agent-thinking italic animate-pulse mb-1">
            {liveHint}
          </div>
        )}
        <div className="prose-hermes prose-hermes-compact text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeLatex(displayText || "")}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-emerald-signal/70 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {message.status === "failed" && (
          <div className="mt-1 text-[11px] text-danger">
            {message.error || "Failed"}
          </div>
        )}
      </div>
    </div>
  );
}

function describeEvent(e: TaskEvent): string {
  if (e.event === "tool.started") {
    return e.preview || (e.tool ? `Using ${e.tool}…` : "Running tool…");
  }
  if (e.event === "tool.completed") {
    return "Tool finished.";
  }
  if (e.event === "reasoning.available" || e.event === "reasoning.delta") {
    return "Thinking…";
  }
  return e.event;
}

function ToolEvents({ events, streaming }: { events: TaskEvent[]; streaming?: boolean }) {
  const interesting = events.filter(
    (e) => e.event === "tool.started" || e.event === "tool.completed"
  );
  if (interesting.length === 0) return null;

  return (
    <details className="mb-2" open={streaming}>
      <summary className="text-[10px] text-slate-steel cursor-pointer hover:text-parchment uppercase tracking-wider">
        {interesting.length} tool call{interesting.length === 1 ? "" : "s"}
        {streaming && " (live)"}
      </summary>
      <div className="mt-1 space-y-0.5 pl-2 border-l border-charcoal-subtle">
        {interesting.map((ev, i) => (
          <div key={i} className="text-[11px] text-slate-steel font-mono">
            {ev.preview || ev.tool || ev.event}
          </div>
        ))}
      </div>
    </details>
  );
}
