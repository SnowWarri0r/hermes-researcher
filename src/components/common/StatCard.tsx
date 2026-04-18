export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-carbon border border-charcoal rounded-lg p-4 min-w-[140px]">
      <div className="text-xs font-medium text-slate-steel uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-snow font-[family-name:var(--font-heading)] tracking-tight">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs text-slate-steel">{sub}</div>
      )}
    </div>
  );
}
