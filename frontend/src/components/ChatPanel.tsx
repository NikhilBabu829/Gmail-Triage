import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Mic, Paperclip, SendHorizontal, Sparkles, Square, X } from 'lucide-react'
import { ChatMessageBubble } from './ChatMessageBubble'
import { Button } from './ui'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { cn, isAcceptedImage } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'

export interface ChatPanelHandle {
  focusInput: () => void
  setInput: (text: string) => void
}

interface Props {
  messages: ChatMessage[]
  sending: boolean
  input: string
  /** A state setter, so voice transcripts can append to whatever is already typed. */
  onInputChange: React.Dispatch<React.SetStateAction<string>>
  onSend: (prompt: string, image: File | null) => void
  /** Aborts an in-flight answer stream. */
  onStop: () => void
  onError: (message: string) => void
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
  onError,
  speakingId,
  ttsSupported,
  onToggleSpeech,
  registerHandle,
}: Props) {
  /** The file and its object URL move together so the preview never outlives its blob. */
  const [attachment, setAttachment] = useState<{ file: File; url: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  const stickToBottom = useRef(true)

  const appendTranscript = useCallback(
    (text: string) => {
      onInputChange((current) => (current ? `${current.trimEnd()} ${text}` : text))
    },
    [onInputChange],
  )

  const { supported: sttSupported, listening, interim, toggle: toggleMic } = useSpeechRecognition({
    onTranscript: appendTranscript,
    onError,
  })

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
  }, [input, interim])

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

  const clearAttachment = useCallback(() => {
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const acceptImage = useCallback(
    (file: File | undefined | null) => {
      if (!file) return
      if (!isAcceptedImage(file)) {
        onError('Unsupported file type. Attach a PNG, JPG or WebP image.')
        return
      }
      setAttachment((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { file, url: URL.createObjectURL(file) }
      })
    },
    [onError],
  )

  const submit = () => {
    const prompt = input.trim()
    if (!prompt || sending) return
    // The sent message creates its own object URL, so this preview's can be released.
    onSend(prompt, attachment?.file ?? null)
    onInputChange('')
    clearAttachment()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const file = Array.from(event.clipboardData.files).find(isAcceptedImage)
    if (file) {
      event.preventDefault()
      acceptImage(file)
    }
  }

  // dragenter/dragleave fire for every child element, so track depth rather than a boolean.
  const onDragEnter = (event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    dragDepth.current++
    setDragging(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    acceptImage(Array.from(event.dataTransfer.files)[0])
  }

  return (
    <section
      className="relative flex h-full min-h-0 flex-col border-line md:border-l"
      aria-label="Multimodal RAG assistant"
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-bg/85">
          <ImagePlus className="size-6 text-accent" />
          <p className="text-sm font-medium">Drop an image to attach it</p>
          <p className="text-xs text-muted">PNG, JPG or WebP</p>
        </div>
      )}

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
                Question your triaged email, attach a screenshot, or dictate with the mic.
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
        {attachment && (
          <div className="mb-2 inline-flex items-start gap-2 rounded-lg border border-line bg-panel p-1.5">
            <img
              src={attachment.url}
              alt={`Attachment preview: ${attachment.file.name}`}
              className="size-14 rounded object-cover"
            />
            <div className="min-w-0 max-w-40 pt-0.5">
              <p className="truncate text-xs font-medium">{attachment.file.name}</p>
              <p className="text-[11px] text-muted">
                {(attachment.file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              type="button"
              onClick={clearAttachment}
              aria-label="Remove attached image"
              className="rounded p-0.5 text-muted transition-colors hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {listening && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-red-300">
            <span className="animate-rec size-2 rounded-full bg-red-500" aria-hidden="true" />
            Listening…
            {interim && <span className="truncate text-muted italic">“{interim}”</span>}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded-xl border border-line bg-panel px-1.5 py-1.5 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => acceptImage(event.target.files?.[0])}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            title="Attach an image"
            aria-label="Attach an image"
          >
            <Paperclip className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMic}
            disabled={!sttSupported}
            title={sttSupported ? (listening ? 'Stop recording' : 'Dictate a question') : 'Voice input is not supported in this browser'}
            aria-label={listening ? 'Stop recording' : 'Start voice input'}
            aria-pressed={listening}
            className={cn(listening && 'animate-rec bg-red-500/20 text-red-300')}
          >
            {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
          </Button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Ask about your inbox…"
            aria-label="Message the assistant"
            className="max-h-42 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-ink outline-none placeholder:text-muted"
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
