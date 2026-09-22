import type { RagResponse, TriageRunResponse, TriagedEmail } from './types'

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** A failed fetch means DNS/CORS/connection refused — i.e. the backend is unreachable. */
function toApiError(err: unknown): unknown {
  if (err instanceof ApiError || isAbort(err)) return err
  return new ApiError(`Cannot reach the backend at ${BASE_URL}. Is the API running?`)
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      detail = body.slice(0, 200)
    } catch {
      /* body already consumed or empty */
    }
    throw new ApiError(detail || `Request failed with ${res.status} ${res.statusText}`, res.status)
  }
  return (await res.json()) as T
}

export async function runTriage(signal?: AbortSignal): Promise<TriageRunResponse> {
  try {
    const res = await fetch(`${BASE_URL}/api/triage/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
    return await parseJson<TriageRunResponse>(res)
  } catch (err) {
    throw toApiError(err)
  }
}

export async function fetchSummary(signal?: AbortSignal): Promise<TriagedEmail[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/triage/summary`, { signal })
    const data = await parseJson<unknown>(res)
    // The backend returns a bare array; tolerate a { summary: [...] } wrapper too.
    if (Array.isArray(data)) return data as TriagedEmail[]
    if (data && typeof data === 'object') {
      for (const key of ['summary', 'summaries', 'data', 'items']) {
        const value = (data as Record<string, unknown>)[key]
        if (Array.isArray(value)) return value as TriagedEmail[]
      }
    }
    return []
  } catch (err) {
    throw toApiError(err)
  }
}

interface SseFrame {
  event: string
  data: string
}

/**
 * Splits a raw SSE buffer into complete frames, returning the trailing partial
 * frame so it can be prepended to the next chunk off the wire.
 */
function drainFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  const frames: SseFrame[] = []

  for (const part of parts) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of part.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue // keep-alive comment
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      // A single space after the colon is part of the framing, not the value.
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0 || event !== 'message') {
      frames.push({ event, data: dataLines.join('\n') })
    }
  }

  return { frames, rest }
}

/** `data:` is JSON-encoded by the backend, but tolerate a raw string. */
function decodeData(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

export interface StreamHandlers {
  /** A partial chunk of the answer, to append to what has arrived so far. */
  onToken: (text: string) => void
  /** Citations, if the backend sends a `sources` event. */
  onSources?: (sources: TriagedEmail[]) => void
}

/**
 * POSTs the multipart query and reads the `text/event-stream` reply incrementally.
 * EventSource only speaks GET, so the stream is pulled off fetch's ReadableStream.
 * Falls back to a plain JSON body if the endpoint answers without streaming.
 *
 * Returns the fully assembled answer and any sources that arrived.
 */
export async function streamMultimodalQuery(
  prompt: string,
  image: File | null | undefined,
  { onToken, onSources }: StreamHandlers,
  signal?: AbortSignal,
): Promise<RagResponse> {
  const form = new FormData()
  form.append('prompt', prompt)
  if (image) form.append('image', image, image.name)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/api/rag/multimodal-query`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: form,
      signal,
    })
  } catch (err) {
    throw toApiError(err)
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* no readable body */
    }
    throw new ApiError(detail || `Request failed with ${res.status} ${res.statusText}`, res.status)
  }

  const contentType = res.headers.get('content-type') ?? ''

  // Not a stream (or no streaming body available): treat it as the buffered shape.
  if (!contentType.includes('text/event-stream') || !res.body) {
    const data = (await res.json()) as RagResponse
    const answer = data.answer ?? ''
    if (answer) onToken(answer)
    if (data.sources?.length) onSources?.(data.sources)
    return { answer, sources: data.sources ?? [] }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let sources: TriagedEmail[] = []
  let streamError: string | null = null

  const handle = ({ event, data }: SseFrame) => {
    switch (event) {
      case 'token':
      case 'message': {
        const value = decodeData(data)
        // A token is a plain string; a `message` frame may carry the whole payload.
        if (typeof value === 'string') {
          if (!value) return
          answer += value
          onToken(value)
        } else if (value && typeof value === 'object') {
          const payload = value as Partial<RagResponse> & { text?: string }
          const text = payload.text ?? payload.answer
          if (text) {
            answer += text
            onToken(text)
          }
          if (payload.sources?.length) {
            sources = payload.sources
            onSources?.(sources)
          }
        }
        break
      }
      case 'sources': {
        const value = decodeData(data)
        const list = Array.isArray(value)
          ? value
          : ((value as { sources?: TriagedEmail[] })?.sources ?? [])
        if (list.length) {
          sources = list as TriagedEmail[]
          onSources?.(sources)
        }
        break
      }
      case 'error': {
        const value = decodeData(data)
        streamError =
          typeof value === 'string'
            ? value
            : ((value as { message?: string; error?: string })?.message ??
              (value as { error?: string })?.error ??
              'The assistant reported an error.')
        break
      }
      default:
        break // `done` and anything unrecognised need no handling
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = drainFrames(buffer)
      buffer = rest
      for (const frame of frames) handle(frame)
    }
    // Flush a final frame that arrived without its trailing blank line.
    buffer += decoder.decode()
    const { frames } = drainFrames(buffer + '\n\n')
    for (const frame of frames) handle(frame)
  } catch (err) {
    throw toApiError(err)
  } finally {
    reader.releaseLock()
  }

  if (streamError) throw new ApiError(streamError)

  return { answer, sources }
}

export { BASE_URL }
