import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { TriagedEmail } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Splits `Apple <no_reply@email.apple.com>` into its display name and address. */
export function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/)
  if (match) return { name: match[1].replace(/["']/g, '').trim(), email: match[2].trim() }
  return { name: raw, email: raw }
}

/** A sender line can be `<a@b.com>` with no name — fall back to the address. */
export function senderName(raw: string): string {
  const { name, email } = parseSender(raw)
  return name || email
}

/** Stable two-letter monogram for a sender avatar. */
export function initials(raw: string): string {
  const name = senderName(raw).replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  if (!name) return '?'
  const parts = name.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Deterministic hue per sender so avatars stay the same colour across renders. */
export function senderHue(raw: string): number {
  let hash = 0
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) % 360
  return hash
}

const FINANCIAL_PATTERNS = [
  /invoice/i,
  /receipt/i,
  /\bbill(ed|ing|s)?\b/i,
  /\bpayment\b/i,
  /\bsubscription\b/i,
  /₹/,
  /\$/,
  /€/,
  /£/,
]

export function isFinancial(email: TriagedEmail): boolean {
  return FINANCIAL_PATTERNS.some((re) => re.test(email.summary))
}

export interface Metrics {
  total: number
  uniqueSenders: number
  financial: number
}

export function computeMetrics(emails: TriagedEmail[]): Metrics {
  const senders = new Set<string>()
  let financial = 0
  for (const email of emails) {
    senders.add(parseSender(email.sender).email.toLowerCase())
    if (isFinancial(email)) financial++
  }
  return { total: emails.length, uniqueSenders: senders.size, financial }
}

/** Case-insensitive match across sender name, address and summary text. */
export function filterEmails(emails: TriagedEmail[], query: string): TriagedEmail[] {
  const q = query.trim().toLowerCase()
  if (!q) return emails
  return emails.filter((email) => {
    const { name, email: address } = parseSender(email.sender)
    return (
      name.toLowerCase().includes(q) ||
      address.toLowerCase().includes(q) ||
      email.summary.toLowerCase().includes(q) ||
      email.message_id.toLowerCase().includes(q)
    )
  })
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

/** Markdown and emphasis markers read badly when spoken aloud. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\|/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}
