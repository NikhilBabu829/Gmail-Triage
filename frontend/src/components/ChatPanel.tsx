import { useEffect, useRef } from 'react'
import { SendHorizontal, Sparkles, Square } from 'lucide-react'
import { ChatMessageBubble } from './ChatMessageBubble'
import { Button } from './ui'
import type { ChatMessage } from '@/lib/types'

export interface ChatPanelHandle {
  focusInput: () => void
  setInput: (text: string) => void
}

interface Props {
  messages: ChatMessage[]
  sending: boolean
  input: string
  onInputChange: React.Dispatch<React.SetStateAction<string>>
  onSend: (prompt: string) => void
  /** Aborts an in-flight answer stream. */
  onStop: () => void
  speakingId: string | null
  ttsSupported: boolean
  onToggleSpeech: (message: ChatMessage) => void
  /** Registers the imperative handle the dashboard uses for "Ask Copilot about this". */
  registerHandle: (handle: ChatPanelHandle | null) => void
}

const SUGGESTIONS = [
  'What invoices arrived today?',
  'Any job alerts I should act on?',
  'Summarise everything needing a reply',
]

export function ChatPanel({
  messages,
  sending,
  input,
  onInputChange,
  onSend,
  onStop,
  speakingId,
  ttsSupported,
  onToggleSpeech,
  registerHandle,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Expose focus/prefill to the dashboard so a triage card can seed the prompt.
  useEffect(() => {
    registerHandle({
      focusInput: () => textareaRef.current?.focus(),
      setInput: (text) => {
        onInputChange(text)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (!el) return
          el.focus()
          el.setSelectionRange(text.length, text.length)
        })
      },
    })
    return () => registerHandle(null)
  }, [registerHandle, onInputChange])

  // Auto-resize the textarea to its content, capped so the stream keeps most of the panel.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [input])

  // Follow new tokens, but stop following once the user scrolls up to read back.
  useEffect(() => {
    const el = streamRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onStreamScroll = () => {
    const el = streamRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distance < 48
  }

  const submit = () => {
    const prompt = input.trim()
    if (!prompt || sending) return
    onSend(prompt)
    onInputChange('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section
      className="relative flex h-full min-h-0 flex-col border-line md:border-l"
      aria-label="Inbox assistant"
    >
      <div
        ref={streamRef}
        onScroll={onStreamScroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-accent/30 bg-accentsoft">
              <Sparkles className="size-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium">Ask about your inbox</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
                Ask a question about your triaged email, or pick one of these.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    onInputChange(suggestion)
                    textareaRef.current?.focus()
                  }}
                  className="rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-[#323a47] hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessageBubble
              key={message.id}
              message={message}
              speaking={speakingId === message.id}
              ttsSupported={ttsSupported}
              onToggleSpeech={onToggleSpeech}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-panel/40 px-4 py-3 md:px-5">
        <div className="flex items-end gap-1.5 rounded-xl border border-line bg-panel px-1.5 py-1.5 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about your inbox…"
            aria-label="Message the assistant"
            className="max-h-42 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink outline-none placeholder:text-muted"
          />

          {sending ? (
            <Button
              variant="danger"
              size="icon"
              onClick={onStop}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="icon"
              onClick={submit}
              disabled={input.trim().length === 0}
              title="Send"
              aria-label="Send message"
            >
              <SendHorizontal className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
