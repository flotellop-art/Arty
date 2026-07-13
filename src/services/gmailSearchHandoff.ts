import { Capacitor } from '@capacitor/core'
import type { GmailSearchAssumption, GmailSearchPayload } from '../types'

export type { GmailSearchAssumption, GmailSearchPayload } from '../types'

export const GMAIL_HOME_URL = 'https://mail.google.com/'
export const GMAIL_SEARCH_PAYLOAD_TTL_MS = 60 * 60 * 1000

const MAX_SOURCE_LENGTH = 2_000
const MAX_QUERY_LENGTH = 500
const BIDI_AND_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
const HAS_BIDI_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const EMAIL_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi
const ALLOWED_OPERATORS = new Set(['from', 'to', 'subject', 'after', 'before', 'has', 'is'])

const MONTHS: Record<string, number> = {
  janvier: 0,
  january: 0,
  fevrier: 1,
  february: 1,
  mars: 2,
  march: 2,
  avril: 3,
  april: 3,
  mai: 4,
  may: 4,
  juin: 5,
  june: 5,
  juillet: 6,
  july: 6,
  aout: 7,
  august: 7,
  septembre: 8,
  september: 8,
  octobre: 9,
  october: 9,
  novembre: 10,
  november: 10,
  decembre: 11,
  december: 11,
}

const STOP_WORDS = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du', 'en', 'et',
  'je', 'la', 'le', 'les', 'mail', 'mails', 'email', 'emails', 'courriel', 'courriels',
  'mes', 'mon', 'que', 'qui', 'sur', 'un', 'une', 'pour', 'stp', 'svp',
  'cherche', 'chercher', 'recherche', 'rechercher', 'retrouve', 'retrouver', 'trouve', 'trouver',
  'affiche', 'afficher', 'montre', 'montrer', 'lis', 'lire',
  'find', 'search', 'look', 'show', 'the', 'my', 'me', 'for', 'an', 'and', 'in', 'email', 'emails',
  'from', 'about', 'with', 'please', 'sent', 'message', 'messages',
])

export interface GmailSearchCompilation {
  payload: GmailSearchPayload
  source: string
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function cleanSource(value: string): string {
  return value
    .normalize('NFKC')
    .replace(BIDI_AND_CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SOURCE_LENGTH)
}

function quoteValue(value: string): string {
  const safe = value
    .replace(BIDI_AND_CONTROL, ' ')
    .replace(/["\\]/g, ' ')
    .replace(/[:(){}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return safe.includes(' ') ? `"${safe}"` : safe
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function datePart(year: number, month: number, day = 1): string {
  return `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`
}

export function isGmailSearchIntent(value: string): boolean {
  const text = fold(cleanSource(value))
  if (!text) return false

  const mentionsMail = /\b(?:gmail|mails?|e-?mails?|courriels?|messages?)\b/.test(text)
  if (!mentionsMail) return false

  const searchAction = /\b(?:cherche(?:r)?|recherche(?:r)?|retrouve(?:r)?|trouve(?:r)?|affiche(?:r)?|montre(?:r)?|lis|lire|find|search|show|look)\b/.test(text)
  const globalReading = /\b(?:non lus?|unread|recus?|received|piece jointe|attachment)\b/.test(text)
  const writingOnly = /\b(?:ecris|redige|compose|write|draft)\b/.test(text) && !searchAction

  return !writingOnly && (searchAction || globalReading)
}

function extractSender(source: string): string | null {
  const email = source.match(new RegExp(`(?:\\bfrom\\b|\\bde\\b|\\bpar\\b)\\s+(?:la\\s+part\\s+de\\s+)?(${EMAIL_RE.source})`, 'i'))
  if (email?.[1]) return email[1]

  const marker = /(?:\b(?:mail|email|courriel|message)s?\s+(?:envoy[eé]s?\s+)?(?:de|from)|\bfrom)\s+/i.exec(source)
  if (!marker) return null
  const tail = source.slice(marker.index + marker[0].length)
  const candidate = tail
    .split(/\s+(?:au\s+sujet|concernant|about|avec|with|qui|that|en\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december))\b/i)[0]
    ?.split(/[,.!?;]/)[0]
    ?.trim()
  if (!candidate) return null

  const words = candidate.split(/\s+/).slice(0, 3)
  const safe = words.filter((word) => /^[\p{L}\p{N}.'’@_+-]+$/u.test(word)).join(' ')
  return safe || null
}

function extractSubject(source: string): string | null {
  const match = /(?:au\s+sujet\s+(?:de\s+|du\s+|des\s+)?|concernant\s+|\bobjet\s*:?\s*|\babout\s+|\bsubject\s*:?\s*)([^,.!?;]+)/i.exec(source)
  if (!match?.[1]) return null
  const value = match[1]
    .split(/\s+(?:en|de|du|pour|with)\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/i)[0]
    ?.trim()
  return value || null
}

function extractMonthRange(source: string, now: Date): {
  parts: string[]
  assumption?: GmailSearchAssumption
  matchedText?: string
} {
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
  const match = new RegExp(`\\b(${monthNames})(?:\\s+(20\\d{2}))?\\b`, 'i').exec(fold(source))
  if (!match?.[1]) return { parts: [] }

  const month = MONTHS[match[1].toLowerCase()]
  if (month === undefined) return { parts: [] }
  const explicitYear = match[2] ? Number(match[2]) : null
  const year = explicitYear ?? now.getFullYear()
  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear = month === 11 ? year + 1 : year
  return {
    parts: [`after:${datePart(year, month)}`, `before:${datePart(nextYear, nextMonth)}`],
    matchedText: match[0],
    ...(explicitYear
      ? {}
      : { assumption: { kind: 'date' as const, label: `${match[1]} ${year}` } }),
  }
}

function fallbackTerms(source: string, consumed: string[]): string[] {
  let remaining = fold(source)
  for (const value of consumed) {
    if (value) remaining = remaining.replace(new RegExp(escapeRegExp(fold(value)), 'g'), ' ')
  }
  remaining = remaining
    .replace(EMAIL_RE, ' ')
    .replace(/\b(?:non\s+lus?|unread|pi[eè]ces?\s+jointes?|attachments?)\b/g, ' ')

  const seen = new Set<string>()
  const terms: string[] = []
  for (const token of remaining.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    if (token.length < 2 || STOP_WORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    terms.push(token)
    if (terms.length >= 8) break
  }
  return terms
}

export function validateGmailSearchQuery(query: string, source: string): boolean {
  if (!query || query.length > MAX_QUERY_LENGTH || HAS_BIDI_OR_CONTROL.test(query)) return false
  if (/https?:\/\/|\/u\/\d+\/|[?&#](?:q|query|token|callback)=/i.test(query)) return false

  for (const match of query.matchAll(/(?:^|\s)([a-z_]+):/g)) {
    if (!match[1] || !ALLOWED_OPERATORS.has(match[1])) return false
  }

  const sourceEmails = new Set((cleanSource(source).match(EMAIL_RE) ?? []).map((email) => email.toLowerCase()))
  for (const email of query.match(EMAIL_RE) ?? []) {
    if (!sourceEmails.has(email.toLowerCase())) return false
  }

  return true
}

export function compileGmailSearch(
  value: string,
  now: Date = new Date(),
): GmailSearchCompilation | null {
  const source = cleanSource(value)
  if (!isGmailSearchIntent(source)) return null

  const parts: string[] = []
  const assumptions: GmailSearchAssumption[] = []
  const consumed: string[] = []
  const sender = extractSender(source)
  const subject = extractSubject(source)
  const monthRange = extractMonthRange(source, now)

  if (sender) {
    parts.push(`from:${quoteValue(sender)}`)
    consumed.push(sender)
  }
  if (subject) {
    parts.push(`subject:${quoteValue(subject)}`)
    consumed.push(subject)
  }
  if (monthRange.parts.length) {
    parts.push(...monthRange.parts)
    if (monthRange.matchedText) consumed.push(monthRange.matchedText)
    if (monthRange.assumption) assumptions.push(monthRange.assumption)
  }

  const folded = fold(source)
  if (/\b(?:non\s+lus?|unread)\b/.test(folded)) parts.push('is:unread')
  if (/\b(?:pi[eè]ces?\s+jointes?|attachments?)\b/.test(folded)) parts.push('has:attachment')

  if (!subject) parts.push(...fallbackTerms(source, consumed))

  const query = [...new Set(parts)].join(' ').trim().slice(0, MAX_QUERY_LENGTH)
  if (!validateGmailSearchQuery(query, source)) return null

  const createdAt = now.getTime()
  return {
    source,
    payload: {
      type: 'gmail_search',
      version: 1,
      query,
      assumptions,
      createdAt,
      expiresAt: createdAt + GMAIL_SEARCH_PAYLOAD_TTL_MS,
    },
  }
}

export function isValidGmailSearchPayload(value: unknown, now = Date.now()): value is GmailSearchPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<GmailSearchPayload>
  return payload.type === 'gmail_search'
    && payload.version === 1
    && typeof payload.query === 'string'
    && payload.query.length > 0
    && payload.query.length <= MAX_QUERY_LENGTH
    && Array.isArray(payload.assumptions)
    && payload.assumptions.every((assumption) => !!assumption
      && typeof assumption === 'object'
      && (assumption as Partial<GmailSearchAssumption>).kind === 'date'
      && typeof (assumption as Partial<GmailSearchAssumption>).label === 'string'
      && ((assumption as Partial<GmailSearchAssumption>).label?.length ?? 0) <= 80)
    && typeof payload.createdAt === 'number'
    && typeof payload.expiresAt === 'number'
    && payload.createdAt <= now + 60_000
    && payload.expiresAt > now
    && payload.expiresAt - payload.createdAt <= GMAIL_SEARCH_PAYLOAD_TTL_MS
    && validateGmailSearchQuery(payload.query, payload.query)
}

export async function copyGmailSearch(
  query: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) throw new Error('clipboard_unavailable')
  await clipboard.writeText(query)
}

export async function openGmailHome(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: GMAIL_HOME_URL })
    return
  }

  const opened = window.open(GMAIL_HOME_URL, '_blank', 'noopener,noreferrer')
  if (!opened) {
    // Les navigateurs peuvent bloquer un nouvel onglet après l'await du
    // presse-papiers. La navigation dans l'onglet courant reste autorisée,
    // respecte l'ordre copie → Gmail et la carte est déjà persistée pour le
    // bouton Retour. Aucun paramètre n'est ajouté à l'URL.
    window.location.assign(GMAIL_HOME_URL)
  }
}

export async function copyThenOpenGmail(
  query: string,
  actions: {
    copy: (value: string) => Promise<void>
    open: () => Promise<void>
  } = { copy: copyGmailSearch, open: openGmailHome },
): Promise<void> {
  await actions.copy(query)
  try {
    await actions.open()
  } catch {
    throw new Error('gmail_open_failed')
  }
}
