import type { LucideIcon } from 'lucide-react'

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-medium tracking-wide uppercase">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl leading-none font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}
