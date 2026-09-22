/** Exactly the shape the backend returns from GET /api/triage/summary. */
export interface TriagedEmail {
  message_id: string
  sender: string
  summary: string
}

export interface TriageRunResponse {
  status: 'running' | 'completed'
  message: string
}

export interface RagResponse {
  /** Markdown formatted answer. */
  answer: string
  sources: TriagedEmail[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Raw text for user messages, markdown for assistant messages. */
  content: string
  /** Object URL of an attached image, user messages only. */
  imageUrl?: string
  sources?: TriagedEmail[]
  /** Waiting on the first token. */
  pending?: boolean
  /** Tokens are still arriving. */
  streaming?: boolean
  error?: boolean
}
