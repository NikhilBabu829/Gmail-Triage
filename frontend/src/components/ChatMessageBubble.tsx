import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Sparkles, Square, User, Volume2 } from 'lucide-react'
import { SourcesAccordion } from './SourcesAccordion'
import { Spinner } from './ui'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'

interface Props {
  message: ChatMessage
  speaking: boolean
  ttsSupported: boolean
  onToggleSpeech: (message: ChatMessage) => void
}

export function ChatMessageBubble({ message, speaking, ttsSupported, onToggleSpeech }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border',
          isUser ? 'border-line bg-panel2 text-muted' : 'border-accent/35 bg-accentsoft text-accent',
        )}
        aria-hidden="true"
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div className={cn('min-w-0 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-xl border px-3 py-2.5',
            isUser
              ? 'border-accent/30 bg-accentsoft/70 text-ink'
              : message.error
                ? 'border-red-500/35 bg-red-500/5 text-red-200'
                : 'border-line bg-panel',
          )}
        >
          {message.pending ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-3.5" />
              Searching your inbox…
            </div>
          ) : isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="md-body">
              <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
              {message.streaming && (
                <span
                  className="animate-caret ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-accent align-baseline"
                  aria-hidden="true"
                />
              )}
            </div>
          )}

          {!isUser && message.sources && <SourcesAccordion sources={message.sources} />}
        </div>

        {!isUser && !message.pending && !message.streaming && !message.error && ttsSupported && (
          <button
            type="button"
            onClick={() => onToggleSpeech(message)}
            aria-label={speaking ? 'Stop reading answer aloud' : 'Read answer aloud'}
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
              speaking ? 'text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {speaking ? <Square className="size-3 fill-current" /> : <Volume2 className="size-3" />}
            {speaking ? 'Stop' : 'Listen'}
          </button>
        )}
      </div>
    </div>
  )
}
