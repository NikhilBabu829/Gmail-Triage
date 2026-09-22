import { useCallback, useEffect, useRef, useState } from 'react'
import { TopBar } from '@/components/TopBar'
import { TriageFeed } from '@/components/TriageFeed'
import { ChatPanel, type ChatPanelHandle } from '@/components/ChatPanel'
import { Toaster } from '@/components/Toaster'
import { useToasts } from '@/hooks/useToasts'
import { useSpeech } from '@/hooks/useSpeech'
import { ApiError, fetchSummary, isAbort, runTriage, streamRagQuery } from '@/lib/api'
import { senderName, truncate } from '@/lib/utils'
import type { ChatMessage, TriagedEmail } from '@/lib/types'
import localSummary from 'virtual:triage-summary'

const AUTO_READ_KEY = 'gmail-triage:auto-read'

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function App() {
  // Seeded from the summary.json the backend wrote — no request on load, because
  // GET /api/triage/summary re-runs summarisation. Only a triage run refreshes it.
  const [emails, setEmails] = useState<TriagedEmail[]>(() => [...localSummary])
  const [refreshing, setRefreshing] = useState(false)
  const [running, setRunning] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const [autoRead, setAutoRead] = useState(() => {
    try {
      return localStorage.getItem(AUTO_READ_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileView, setMobileView] = useState<'feed' | 'chat'>('feed')

  const { toasts, push, dismiss } = useToasts()
  const speech = useSpeech()
  const chatHandle = useRef<ChatPanelHandle | null>(null)
  /** Aborts the in-flight SSE read when the user stops generation. */
  const streamRef = useRef<AbortController | null>(null)
  const registerHandle = useCallback((handle: ChatPanelHandle | null) => {
    chatHandle.current = handle
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_READ_KEY, autoRead ? '1' : '0')
    } catch {
      /* Storage can be unavailable in private mode; the toggle still works in-session. */
    }
  }, [autoRead])

  /** Pulls the live summary from the API. Only ever called on an explicit user action. */
  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      setRefreshing(true)
      try {
        const data = await fetchSummary(signal)
        setEmails(data)
        setSummaryError(null)
        return data
      } catch (err) {
        if (isAbort(err)) return null
        const message = err instanceof ApiError ? err.message : 'Unexpected error loading summary.'
        setSummaryError(message)
        push('Backend unreachable', { description: message, variant: 'error' })
        return null
      } finally {
        setRefreshing(false)
      }
    },
    [push],
  )

  const handleRunTriage = useCallback(async () => {
    setRunning(true)
    try {
      const result = await runTriage()
      const data = await loadSummary()
      push(result.status === 'completed' ? 'Triage complete' : 'Triage started', {
        description:
          result.message ||
          (data ? `${data.length} email${data.length === 1 ? '' : 's'} in the feed.` : undefined),
        variant: 'success',
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not start the triage run.'
      push('Triage failed', { description: message, variant: 'error' })
    } finally {
      setRunning(false)
    }
  }, [loadSummary, push])

  const handleAskCopilot = useCallback((email: TriagedEmail) => {
    const prompt = `Tell me more about the email from ${senderName(email.sender)} regarding ${truncate(
      email.summary,
      120,
    )}`
    chatHandle.current?.setInput(prompt)
    setMobileView('chat')
    // The panel mounts on first switch to the chat view, so re-apply after it exists.
    requestAnimationFrame(() => chatHandle.current?.setInput(prompt))
  }, [])

  const handleSend = useCallback(
    async (prompt: string) => {
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: prompt,
      }
      const placeholderId = newId()
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: placeholderId, role: 'assistant', content: '', pending: true },
      ])
      setSending(true)

      const patch = (id: string, changes: Partial<ChatMessage>) =>
        setMessages((prev) =>
          prev.map((message) => (message.id === id ? { ...message, ...changes } : message)),
        )

      const controller = new AbortController()
      streamRef.current = controller

      try {
        const result = await streamRagQuery(
          prompt,
          {
            onToken: (text) =>
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === placeholderId
                    ? {
                        ...message,
                        pending: false,
                        streaming: true,
                        content: message.content + text,
                      }
                    : message,
                ),
              ),
            onSources: (sources) => patch(placeholderId, { sources }),
          },
          controller.signal,
        )

        // A stream that closed without emitting a single token still needs to say something.
        const answer =
          result.answer ||
          'No answer came back for that question. There may be no matching emails indexed yet.'
        patch(placeholderId, {
          pending: false,
          streaming: false,
          content: answer,
          sources: result.sources,
        })
        // Speech synthesis can't consume a stream, so read the finished answer.
        if (autoRead && answer) speech.speak(placeholderId, answer)
      } catch (err) {
        if (isAbort(err)) {
          // Keep whatever streamed in before the user hit stop.
          setMessages((prev) =>
            prev.map((item) =>
              item.id === placeholderId
                ? item.content
                  ? { ...item, pending: false, streaming: false }
                  : { ...item, pending: false, streaming: false, error: true, content: 'Stopped.' }
                : item,
            ),
          )
          return
        }
        const message = err instanceof ApiError ? err.message : 'The assistant request failed.'
        setMessages((prev) =>
          prev.map((item) =>
            item.id === placeholderId
              ? { ...item, pending: false, streaming: false, error: true, content: message }
              : item,
          ),
        )
        push('Copilot request failed', { description: message, variant: 'error' })
      } finally {
        if (streamRef.current === controller) streamRef.current = null
        setSending(false)
      }
    },
    [autoRead, push, speech],
  )

  const handleStopStream = useCallback(() => {
    streamRef.current?.abort()
    streamRef.current = null
  }, [])

  // A navigation mid-stream should not leave the request hanging.
  useEffect(() => () => streamRef.current?.abort(), [])

  const handleToggleSpeech = useCallback(
    (message: ChatMessage) => speech.toggle(message.id, message.content),
    [speech],
  )

  const handleVoiceError = useCallback(
    (message: string) => push('Voice input unavailable', { description: message, variant: 'error' }),
    [push],
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar
        running={running}
        refreshing={refreshing}
        autoRead={autoRead}
        onAutoReadChange={setAutoRead}
        onRunTriage={handleRunTriage}
        onRefresh={() => void loadSummary()}
        speaking={speech.speaking}
        onStopSpeech={speech.stop}
        ttsSupported={speech.supported}
        mobileView={mobileView}
        onMobileViewChange={setMobileView}
      />

      <main className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className={mobileView === 'feed' ? 'min-h-0' : 'hidden min-h-0 md:block'}>
          <TriageFeed
              emails={emails}
              running={running}
              error={summaryError}
              query={query}
              onQueryChange={setQuery}
              onRunTriage={handleRunTriage}
            onAskCopilot={handleAskCopilot}
          />
        </div>

        <div className={mobileView === 'chat' ? 'min-h-0' : 'hidden min-h-0 md:block'}>
          <ChatPanel
              messages={messages}
              sending={sending}
              input={input}
              onInputChange={setInput}
              onSend={handleSend}
              onStop={handleStopStream}
              onError={handleVoiceError}
              speakingId={speech.speakingId}
              ttsSupported={speech.supported}
              onToggleSpeech={handleToggleSpeech}
            registerHandle={registerHandle}
          />
        </div>
      </main>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
