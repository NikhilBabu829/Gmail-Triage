import { useCallback, useEffect, useRef, useState } from 'react'

/* The Web Speech API is still vendor-prefixed in most browsers and is not in lib.dom. */
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
  length: number
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionErrorEventLike {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Why dictation can't run here, or null when it can. */
function unsupportedReason(): string | null {
  if (typeof window === 'undefined') return 'Voice input is unavailable.'
  if (!window.isSecureContext) {
    return `Voice input needs a secure page. Open the app on localhost or over https:// (this page is ${window.location.origin}).`
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser exposes no microphone API, so voice input is unavailable.'
  }
  if (!getCtor()) {
    return 'This browser has no Speech Recognition support. Chrome, Edge or Safari can dictate; Firefox cannot.'
  }
  return null
}

interface Options {
  /** Called with each finalised chunk of speech, to append to the input. */
  onTranscript: (text: string) => void
  onError?: (message: string) => void
}

/** Chrome ends a session after a few seconds of silence; restart unless the user stopped. */
const RESTART_DELAY_MS = 250
const MAX_RESTARTS_PER_MINUTE = 40

export function useSpeechRecognition({ onTranscript, onError }: Options) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  /** The mic capture we hold open so the browser shows its "in use" indicator. */
  const streamRef = useRef<MediaStream | null>(null)
  /** True while the user wants to dictate — survives the engine's own restarts. */
  const wantListeningRef = useRef(false)
  const restartTimesRef = useRef<number[]>([])
  const restartTimerRef = useRef<number | null>(null)

  const supported = unsupportedReason() === null

  // Keep the latest callbacks without tearing down an active session.
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onTranscript, onError])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    const recognition = recognitionRef.current
    recognitionRef.current = null
    try {
      recognition?.stop()
    } catch {
      /* already stopped */
    }
    releaseStream()
    setListening(false)
    setInterim('')
  }, [releaseStream])

  /** Lets a session's `onend` start its successor without self-referencing the callback. */
  const spawnSessionRef = useRef<() => void>(() => {})

  /** Builds and starts one recognition session. Assumes permission is already granted. */
  const spawnSession = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onstart = () => {
      // Only now is the mic genuinely live.
      setListening(true)
    }

    recognition.onresult = (event) => {
      let live = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const trimmed = text.trim()
          if (trimmed) onTranscriptRef.current(trimmed)
        } else {
          live += text
        }
      }
      setInterim(live)
    }

    recognition.onerror = (event) => {
      // Silence and self-aborts are routine; onend restarts the session.
      if (event.error === 'no-speech' || event.error === 'aborted') return

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onErrorRef.current?.(
          'Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
        )
      } else if (event.error === 'network') {
        onErrorRef.current?.(
          'Speech recognition could not reach its network service. Some browsers (Brave, for example) block it.',
        )
      } else if (event.error === 'audio-capture') {
        onErrorRef.current?.('No microphone was found. Check your input device and try again.')
      } else {
        onErrorRef.current?.(`Voice input failed (${event.error}).`)
      }
      // These are fatal for the session; don't fight them with restarts.
      wantListeningRef.current = false
    }

    recognition.onend = () => {
      setInterim('')
      if (!wantListeningRef.current) {
        recognitionRef.current = null
        releaseStream()
        setListening(false)
        return
      }

      // Guard against a session that dies instantly and spins.
      const now = Date.now()
      restartTimesRef.current = restartTimesRef.current.filter((t) => now - t < 60_000)
      if (restartTimesRef.current.length >= MAX_RESTARTS_PER_MINUTE) {
        wantListeningRef.current = false
        recognitionRef.current = null
        releaseStream()
        setListening(false)
        onErrorRef.current?.('Voice input kept dropping out, so it has been switched off.')
        return
      }
      restartTimesRef.current.push(now)
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        if (wantListeningRef.current) spawnSessionRef.current()
      }, RESTART_DELAY_MS)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      // start() throws if a previous session is still winding down; onend will retry.
      recognitionRef.current = null
    }
  }, [releaseStream])

  useEffect(() => {
    spawnSessionRef.current = spawnSession
  }, [spawnSession])

  const start = useCallback(async () => {
    const reason = unsupportedReason()
    if (reason) {
      onErrorRef.current?.(reason)
      return
    }
    if (wantListeningRef.current) return

    // Ask for the microphone explicitly. SpeechRecognition alone does not reliably
    // prompt, and holding the stream is what shows the browser's mic indicator.
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        onErrorRef.current?.(
          'Microphone permission was denied. Allow it for this site in your browser settings, then try again.',
        )
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        onErrorRef.current?.('No microphone was found. Connect one and try again.')
      } else {
        onErrorRef.current?.(`Could not open the microphone (${name ?? 'unknown error'}).`)
      }
      return
    }

    wantListeningRef.current = true
    restartTimesRef.current = []
    spawnSession()
  }, [spawnSession])

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop()
    else void start()
  }, [start, stop])

  // Never leave the microphone open behind us.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current)
      try {
        recognitionRef.current?.abort()
      } catch {
        /* nothing to abort */
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return { supported, unsupportedReason: unsupportedReason(), listening, interim, start, stop, toggle }
}
