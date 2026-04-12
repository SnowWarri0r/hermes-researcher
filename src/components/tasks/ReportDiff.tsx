import { diffLines, type Change } from "diff";

export function ReportDiff({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const changes = diffLines(oldText, newText);

  return (
    <div className="font-mono text-[12px] leading-relaxed bg-carbon border border-charcoal rounded-md overflow-x-auto max-h-[600px] overflow-y-auto">
      {changes.map((change, i) => (
        <DiffBlock key={i} change={change} />
      ))}
    </div>
  );
}

function DiffBlock({ change }: { change: Change }) {
  const lines = change.value.split("\n");
  // diff library sometimes includes trailing empty string from split
  if (lines[lines.length - 1] === "") lines.pop();

  if (!change.added && !change.removed) {
    // Context: show first 2 and last 2 lines, collapse middle if >5
    if (lines.length > 5) {
      const head = lines.slice(0, 2);
      const tail = lines.slice(-2);
      return (
        <>
          {head.map((l, i) => (
            <div key={`h${i}`} className="px-3 py-0 text-slate-steel">
              <span className="inline-block w-5 text-slate-steel/40 select-none"> </span>
              {l}
            </div>
          ))}
          <div className="px-3 py-1 text-slate-steel/40 text-center text-[10px] border-y border-charcoal-subtle">
            ··· {lines.length - 4} unchanged lines ···
          </div>
          {tail.map((l, i) => (
            <div key={`t${i}`} className="px-3 py-0 text-slate-steel">
              <span className="inline-block w-5 text-slate-steel/40 select-none"> </span>
              {l}
            </div>
          ))}
        </>
      );
    }
    return (
      <>
        {lines.map((l, i) => (
          <div key={i} className="px-3 py-0 text-slate-steel">
            <span className="inline-block w-5 text-slate-steel/40 select-none"> </span>
            {l}
          </div>
        ))}
      </>
    );
  }

  if (change.added) {
    return (
      <>
        {lines.map((l, i) => (
          <div key={i} className="px-3 py-0 bg-success/8 text-success">
            <span className="inline-block w-5 text-success/60 select-none">+</span>
            {l}
          </div>
        ))}
      </>
    );
  }

  // removed
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="px-3 py-0 bg-danger/8 text-danger/70 line-through decoration-danger/30">
          <span className="inline-block w-5 text-danger/60 select-none">-</span>
          {l}
        </div>
      ))}
    </>
  );
}
