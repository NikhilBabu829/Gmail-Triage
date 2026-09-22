import { Mail, PlayCircle, RefreshCw, Square, Volume2 } from 'lucide-react'
import { Button, Spinner, Switch } from './ui'
import { cn } from '@/lib/utils'

interface Props {
  running: boolean
  refreshing: boolean
  autoRead: boolean
  onAutoReadChange: (next: boolean) => void
  onRunTriage: () => void
  onRefresh: () => void
  speaking: boolean
  onStopSpeech: () => void
  ttsSupported: boolean
  /** Which panel is showing on narrow screens. */
  mobileView: 'feed' | 'chat'
  onMobileViewChange: (next: 'feed' | 'chat') => void
}

export function TopBar({
  running,
  refreshing,
  autoRead,
  onAutoReadChange,
  onRunTriage,
  onRefresh,
  speaking,
  onStopSpeech,
  ttsSupported,
  mobileView,
  onMobileViewChange,
}: Props) {
  return (
    <header className="shrink-0 border-b border-line bg-panel/60 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accentsoft">
            <Mail className="size-4 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm leading-tight font-semibold">
              Gmail Triage &amp; Copilot
            </h1>
            <p className="truncate text-[11px] text-muted">Daily inbox triage, summarised</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {speaking && ttsSupported && (
            <Button variant="danger" size="sm" onClick={onStopSpeech}>
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          )}

          {ttsSupported && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-1.5">
              <Volume2 className={cn('size-3.5', autoRead ? 'text-accent' : 'text-muted')} />
              <label htmlFor="auto-read" className="cursor-pointer text-xs text-muted select-none">
                Auto-Read
              </label>
              <Switch
                id="auto-read"
                checked={autoRead}
                onChange={onAutoReadChange}
                label="Automatically read assistant replies aloud"
              />
            </div>
          )}

          <Button
            variant="secondary"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing || running}
            title="Fetch the latest summary from the API"
            aria-label="Fetch the latest summary from the API"
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>

          <Button variant="primary" onClick={onRunTriage} disabled={running}>
            {running ? <Spinner /> : <PlayCircle className="size-4" />}
            <span className="max-sm:hidden">{running ? 'Triaging inbox…' : 'Run Triage Now'}</span>
          </Button>
        </div>

        <div
          className="flex w-full gap-1 rounded-lg border border-line bg-panel2 p-1 md:hidden"
          role="tablist"
          aria-label="Switch view"
        >
          {(['feed', 'chat'] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={mobileView === view}
              onClick={() => onMobileViewChange(view)}
              className={cn(
                'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                mobileView === view ? 'bg-accent text-white' : 'text-muted hover:text-ink',
              )}
            >
              {view === 'feed' ? 'Triage Feed' : 'Copilot'}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
