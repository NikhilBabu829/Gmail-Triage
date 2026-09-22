import { useState } from 'react'
import { ChevronRight, Link2 } from 'lucide-react'
import { cn, initials, parseSender, senderHue, senderName } from '@/lib/utils'
import type { TriagedEmail } from '@/lib/types'

export function SourcesAccordion({ sources }: { sources: TriagedEmail[] }) {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null

  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-line bg-bg/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs font-medium text-muted transition-colors hover:text-ink"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        <Link2 className="size-3.5" />
        Referenced Emails
        <span className="ml-auto rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[10px] tabular-nums">
          {sources.length}
        </span>
      </button>

      {open && (
        <ul className="space-y-2 border-t border-line px-2.5 py-2.5">
          {sources.map((source, index) => {
            const { email: address } = parseSender(source.sender)
            const name = senderName(source.sender)
            const hue = senderHue(source.sender)
            return (
              <li key={`${source.message_id}-${index}`} className="flex gap-2">
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
                  style={{ background: `hsl(${hue} 55% 20%)`, color: `hsl(${hue} 85% 78%)` }}
                  aria-hidden="true"
                >
                  {initials(source.sender)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" title={source.sender}>
                    {name}
                    {address !== name && (
                      <span className="ml-1 font-normal text-muted">{address}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{source.summary}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
