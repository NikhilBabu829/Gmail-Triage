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
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onspeechstart: (() => void) | null
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

/** Dev-only tracing, so a silent failure can be seen in the console. */
function trace(event: string, detail?: unknown) {
  if (import.meta.env.DEV) {
    if (detail === undefined) console.debug(`[voice] ${event}`)
    else console.debug(`[voice] ${event}`, detail)
  }
}

/** Chrome ends a session after a few seconds of silence; restart unless the user stopped. */
const RESTART_DELAY_MS = 300
/** Consecutive sessions that end without ever capturing audio before we give up loudly. */
const MAX_DEAD_SESSIONS = 4

export type VoicePhase = 'idle' | 'starting' | 'listening'

export function useSpeechRecognition({ onTranscript, onError }: Options) {
  /** `starting` covers the permission prompt, so the UI reacts on the very first click. */
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [interim, setInterim] = useState('')

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  /** True while the user wants to dictate — survives the engine's own restarts. */
  const wantListeningRef = useRef(false)
  const restartTimerRef = useRef<number | null>(null)
  /** Sessions in a row that never reached `audiostart`, i.e. the engine never listened. */
  const deadSessionsRef = useRef(0)
  /** Whether the current session ever got as far as capturing audio. */
  const gotAudioRef = useRef(false)

  const supported = unsupportedReason() === null

  // Keep the latest callbacks without tearing down an active session.
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onTranscript, onError])

  const stop = useCallback(() => {
    trace('stop() called by the user')
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
    setPhase('idle')
    setInterim('')
  }, [])

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
    recognition.maxAlternatives = 1

    gotAudioRef.current = false

    // `audiostart` is the honest signal that the engine has the microphone.
    recognition.onaudiostart = () => {
      trace('audiostart — engine has the microphone')
      gotAudioRef.current = true
      deadSessionsRef.current = 0
      setPhase('listening')
    }
    recognition.onstart = () => {
      trace('start')
      setPhase('listening')
    }

    recognition.onresult = (event) => {
      trace('result', { results: event.results.length })
      gotAudioRef.current = true
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
      trace('error', event.error)
      // Silence and self-aborts are routine; onend decides whether to restart.
      if (event.error === 'no-speech' || event.error === 'aborted') return

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onErrorRef.current?.(
          'Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
        )
      } else if (event.error === 'network') {
        onErrorRef.current?.(
          'Speech recognition could not reach its online service. Chrome and Safari send audio to Google/Apple to transcribe; a VPN, firewall or a browser like Brave can block it.',
        )
      } else if (event.error === 'audio-capture') {
        onErrorRef.current?.('No microphone was found. Check your input device and try again.')
      } else {
        onErrorRef.current?.(`Voice input failed (${event.error}).`)
      }
      wantListeningRef.current = false
    }

    recognition.onend = () => {
      trace('end', { gotAudio: gotAudioRef.current, wantListening: wantListeningRef.current })
      setInterim('')

      if (!wantListeningRef.current) {
        recognitionRef.current = null
        setPhase('idle')
        return
      }

      // A session that ended without ever capturing audio is a real failure, not a
      // silence timeout. Retry a few times, then say so instead of spinning quietly.
      if (!gotAudioRef.current) {
        deadSessionsRef.current += 1
        if (deadSessionsRef.current >= MAX_DEAD_SESSIONS) {
          wantListeningRef.current = false
          recognitionRef.current = null
          setPhase('idle')
          onErrorRef.current?.(
            'The microphone opened but speech recognition returned nothing. This usually means the browser could not reach its transcription service.',
          )
          return
        }
      }

      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        if (wantListeningRef.current) spawnSessionRef.current()
      }, RESTART_DELAY_MS)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      trace('start() called without throwing')
      // Optimistic: some browsers fire neither `start` nor `audiostart` promptly, and the
      // indicator must never be missing while a session is genuinely running.
      setPhase('listening')
    } catch (err) {
      // start() throws if a previous session is still winding down; onend will retry.
      trace('start() threw', err)
      recognitionRef.current = null
    }
  }, [])

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

    // Claim intent *before* awaiting. The permission prompt can sit there for seconds, and
    // until this is set a second click would read as "not listening" and start a rival
    // session instead of stopping this one.
    wantListeningRef.current = true
    deadSessionsRef.current = 0
    setPhase('starting')

    // Prime the microphone permission so the browser definitely prompts, then release it
    // immediately: holding the stream open can stop SpeechRecognition acquiring the mic.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        trace('microphone permission granted; releasing the priming stream')
        stream.getTracks().forEach((track) => track.stop())
      } catch (err) {
        wantListeningRef.current = false
        setPhase('idle')
        const name = (err as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          onErrorRef.current?.(
            'Microphone permission was denied. Allow it for this site in your browser settings, then try again.',
          )
          return
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          onErrorRef.current?.('No microphone was found. Connect one and try again.')
          return
        }
        // Anything else (device busy, for instance): let recognition try anyway.
      }
    }

    // The user may have pressed stop while the permission prompt was open.
    if (!wantListeningRef.current) {
      trace('start aborted — user stopped during the permission prompt')
      return
    }
    spawnSession()
  }, [spawnSession])

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop()
    else void start()
  }, [start, stop])

  // Never leave a recognition session running behind us.
  useEffect(() => {
    return () => {
      trace('component unmounted — aborting any session')
      wantListeningRef.current = false
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current)
      try {
        recognitionRef.current?.abort()
      } catch {
        /* nothing to abort */
      }
    }
  }, [])

  return {
    supported,
    unsupportedReason: unsupportedReason(),
    phase,
    /** True from the moment the button is pressed, including the permission prompt. */
    listening: phase !== 'idle',
    interim,
    start,
    stop,
    toggle,
  }
}
