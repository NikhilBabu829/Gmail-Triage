import { useMemo } from 'react'
import { Inbox, Mails, PlayCircle, Receipt, Search, Users, X } from 'lucide-react'
import { EmailCard } from './EmailCard'
import { MetricCard } from './MetricCard'
import { Button, Spinner } from './ui'
import { computeMetrics, filterEmails } from '@/lib/utils'
import type { TriagedEmail } from '@/lib/types'

interface Props {
  emails: TriagedEmail[]
  running: boolean
  error: string | null
  query: string
  onQueryChange: (next: string) => void
  onRunTriage: () => void
  onAskCopilot: (email: TriagedEmail) => void
}

export function TriageFeed({
  emails,
  running,
  error,
  query,
  onQueryChange,
  onRunTriage,
  onAskCopilot,
}: Props) {
  const metrics = useMemo(() => computeMetrics(emails), [emails])
  const visible = useMemo(() => filterEmails(emails, query), [emails, query])
  const isEmpty = emails.length === 0

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Daily triage feed">
      <div className="shrink-0 space-y-3 px-4 pt-4 md:px-5">
        <div className="grid grid-cols-3 gap-2.5">
          <MetricCard icon={Mails} label="Triaged" value={metrics.total} hint="emails in feed" />
          <MetricCard icon={Users} label="Senders" value={metrics.uniqueSenders} hint="unique" />
          <MetricCard
            icon={Receipt}
            label="Financial"
            value={metrics.financial}
            hint="invoices & bills"
          />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by sender or summary…"
            aria-label="Search triaged emails"
            className="h-10 w-full rounded-lg border border-line bg-panel pr-9 pl-9 text-sm text-ink outline-none placeholder:text-muted focus:border-accent/60 focus:ring-2 focus:ring-accent/25 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-muted transition-colors hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {query && (
          <p className="text-xs text-muted">
            {visible.length} of {emails.length} {emails.length === 1 ? 'email' : 'emails'} match
            {visible.length === 1 ? 'es' : ''} “{query}”
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pt-3 pb-4 md:px-5">
        {error && emails.length === 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-8 text-center">
            <p className="text-sm font-medium text-red-200">Couldn’t load the triage summary</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted">{error}</p>
          </div>
        )}

        {isEmpty && !error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-4 py-14 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-line bg-panel2">
              <Inbox className="size-6 text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium">No triaged emails yet</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
                Run a triage pass to label your inbox and generate summaries for the last 24 hours.
              </p>
            </div>
            <Button variant="primary" onClick={onRunTriage} disabled={running}>
              {running ? <Spinner /> : <PlayCircle className="size-4" />}
              {running ? 'Triaging inbox…' : 'Run First Triage'}
            </Button>
          </div>
        )}

        {emails.length > 0 && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center">
            <p className="text-sm font-medium">No matches</p>
            <p className="mt-1 text-xs text-muted">
              Nothing matches “{query}”. Try a different sender or keyword.
            </p>
          </div>
        )}

        {visible.map((email, index) => (
          // message_id should be unique, but a duplicate from the backend must not break the list.
          <EmailCard key={`${email.message_id}-${index}`} email={email} onAskCopilot={onAskCopilot} />
        ))}
      </div>
    </section>
  )
}
