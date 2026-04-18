import { AVAILABLE_TOOLSETS } from "../../types";

export function ToolsetPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (toolsets: string[]) => void;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {AVAILABLE_TOOLSETS.map((ts) => {
        const active = selected.includes(ts.id);
        return (
          <button
            key={ts.id}
            onClick={() => toggle(ts.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              active
                ? "border-emerald-signal/50 bg-emerald-dim text-emerald-signal"
                : "border-charcoal bg-carbon text-parchment hover:border-charcoal-light hover:text-snow"
            }`}
          >
            <span className="font-mono text-[10px] opacity-60">{ts.icon}</span>
            {ts.label}
          </button>
        );
      })}
    </div>
  );
}
