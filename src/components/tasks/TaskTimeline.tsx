import type { TaskEvent } from "../../types";

export function TaskTimeline({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-slate-steel italic py-2">
        Waiting for events...
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
      {events.map((ev, i) => (
        <TimelineEvent key={i} event={ev} />
      ))}
    </div>
  );
}

function TimelineEvent({ event }: { event: TaskEvent }) {
  const time = event.timestamp
    ? new Date(event.timestamp * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

  switch (event.event) {
    case "tool.started":
      return (
        <div className="flex items-start gap-2 animate-slide-in">
          <span className="text-[10px] font-mono text-slate-steel w-16 shrink-0 pt-0.5">
            {time}
          </span>
          <span className="text-tool-call text-xs">&#x1F527;</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-snow">
              {event.tool}
            </span>
            {event.preview && (
              <div className="text-[11px] text-slate-steel truncate mt-0.5">
                {event.preview}
              </div>
            )}
          </div>
          <span className="text-[10px] text-agent-thinking animate-pulse">
            running
          </span>
        </div>
      );

    case "tool.completed":
      return (
        <div className="flex items-start gap-2 animate-slide-in">
          <span className="text-[10px] font-mono text-slate-steel w-16 shrink-0 pt-0.5">
            {time}
          </span>
          <span
            className={`text-xs ${event.error ? "text-danger" : "text-success"}`}
          >
            {event.error ? "\u2717" : "\u2713"}
          </span>
          <span className="text-xs text-parchment flex-1">
            {event.tool}
          </span>
          {event.duration !== undefined && (
            <span className="text-[10px] font-mono text-slate-steel">
              {event.duration < 1
                ? `${Math.round(event.duration * 1000)}ms`
                : `${event.duration.toFixed(1)}s`}
            </span>
          )}
        </div>
      );

    case "reasoning.available":
      return (
        <div className="flex items-start gap-2 animate-slide-in">
          <span className="text-[10px] font-mono text-slate-steel w-16 shrink-0 pt-0.5">
            {time}
          </span>
          <span className="text-agent-thinking text-xs">&#x1F4AD;</span>
          <div className="text-[11px] text-agent-thinking/80 italic flex-1 line-clamp-2">
            {event.text}
          </div>
        </div>
      );

    case "message.delta":
      return null;

    case "run.completed":
      return (
        <div className="flex items-start gap-2 animate-slide-in">
          <span className="text-[10px] font-mono text-slate-steel w-16 shrink-0 pt-0.5">
            {time}
          </span>
          <span className="text-success text-xs">&#x2705;</span>
          <span className="text-xs font-medium text-success">
            Task completed
          </span>
        </div>
      );

    case "run.failed":
      return (
        <div className="flex items-start gap-2 animate-slide-in">
          <span className="text-[10px] font-mono text-slate-steel w-16 shrink-0 pt-0.5">
            {time}
          </span>
          <span className="text-danger text-xs">&#x274C;</span>
          <span className="text-xs font-medium text-danger">
            Task failed
          </span>
        </div>
      );

    default:
      return (
        <div className="flex items-start gap-2 text-[11px] text-slate-steel">
          <span className="font-mono w-16 shrink-0">{time}</span>
          <span className="flex-1 truncate">
            {event.event}: {event.delta || event.text || ""}
          </span>
        </div>
      );
  }
}
