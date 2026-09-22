import { useCallback, useRef, useState } from 'react'

export type ToastVariant = 'error' | 'success' | 'info'

export interface Toast {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (title: string, opts: { description?: string; variant?: ToastVariant; duration?: number } = {}) => {
      const id = nextId.current++
      const toast: Toast = {
        id,
        title,
        description: opts.description,
        variant: opts.variant ?? 'info',
      }
      setToasts((prev) => [...prev.slice(-3), toast])
      const timer = window.setTimeout(() => dismiss(id), opts.duration ?? 5000)
      timers.current.set(id, timer)
      return id
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}
