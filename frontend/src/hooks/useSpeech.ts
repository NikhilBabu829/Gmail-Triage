import { useCallback, useEffect, useRef, useState } from 'react'
import { stripMarkdown } from '@/lib/utils'

/** Wraps window.speechSynthesis, tracking which message is currently being spoken. */
export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setSpeakingId(null)
  }, [supported])

  const speak = useCallback(
    (id: string, markdown: string) => {
      if (!supported) return
      const text = stripMarkdown(markdown)
      if (!text) return
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.02
      utterance.pitch = 1
      utterance.onend = () => {
        utteranceRef.current = null
        setSpeakingId((current) => (current === id ? null : current))
      }
      utterance.onerror = () => {
        utteranceRef.current = null
        setSpeakingId((current) => (current === id ? null : current))
      }
      utteranceRef.current = utterance
      setSpeakingId(id)
      window.speechSynthesis.speak(utterance)
    },
    [supported],
  )

  const toggle = useCallback(
    (id: string, markdown: string) => {
      if (speakingId === id) stop()
      else speak(id, markdown)
    },
    [speakingId, speak, stop],
  )

  // Leaving the page mid-utterance otherwise keeps the voice running in some browsers.
  useEffect(() => {
    if (!supported) return
    return () => window.speechSynthesis.cancel()
  }, [supported])

  return { supported, speaking: speakingId !== null, speakingId, speak, stop, toggle }
}
