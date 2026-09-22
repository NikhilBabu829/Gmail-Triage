import { useState } from 'react'
import { Check, Copy, MessageSquarePlus, Receipt } from 'lucide-react'
import { Badge, Button } from './ui'
import { initials, isFinancial, parseSender, senderHue, senderName } from '@/lib/utils'
import type { TriagedEmail } from '@/lib/types'

export function EmailCard({
  email,
  onAskCopilot,
}: {
  email: TriagedEmail
  onAskCopilot: (email: TriagedEmail) => void
}) {
  const [copied, setCopied] = useState(false)
  const { email: address } = parseSender(email.sender)
  const name = senderName(email.sender)
  const hue = senderHue(email.sender)
  const financial = isFinancial(email)

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(email.message_id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* Clipboard is unavailable outside a secure context; the id stays visible regardless. */
    }
  }

  return (
    <article className="group rounded-xl border border-line bg-panel p-3.5 transition-colors hover:border-[#2f3743]">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold"
          style={{
            background: `hsl(${hue} 55% 22%)`,
            color: `hsl(${hue} 85% 78%)`,
          }}
          aria-hidden="true"
        >
          {initials(email.sender)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold" title={email.sender}>
              {name}
            </h3>
            {financial && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                <Receipt className="size-2.5" />
                Financial
              </span>
            )}
          </div>
          {address !== name && (
            <p className="truncate text-xs text-muted" title={address}>
              {address}
            </p>
          )}

          <p className="mt-2 text-[13px] leading-relaxed text-ink/90">{email.summary}</p>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={copyId}
              title="Copy message ID"
              aria-label={`Copy message ID ${email.message_id}`}
              className="min-w-0 cursor-pointer"
            >
              <Badge className="max-w-full gap-1 transition-colors hover:border-[#323a47] hover:text-ink">
                {copied ? <Check className="size-2.5 text-emerald-400" /> : <Copy className="size-2.5" />}
                <span className="truncate">{email.message_id}</span>
              </Badge>
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAskCopilot(email)}
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
            >
              <MessageSquarePlus className="size-3.5" />
              Ask Copilot
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
