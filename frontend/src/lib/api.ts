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

export async function multimodalQuery(
  prompt: string,
  image?: File | null,
  signal?: AbortSignal,
): Promise<RagResponse> {
  const form = new FormData()
  form.append('prompt', prompt)
  if (image) form.append('image', image, image.name)
  try {
    const res = await fetch(`${BASE_URL}/api/rag/multimodal-query`, {
      method: 'POST',
      body: form,
      signal,
    })
    return await parseJson<RagResponse>(res)
  } catch (err) {
    throw toApiError(err)
  }
}

export { BASE_URL }
