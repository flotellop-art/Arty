import { gmailContextHeaders } from './event'
import { readBoundedResponseJson } from './http'
import {
  Phase0Error,
  isRecord,
  type CreatedDraft,
  type FetchLike,
  type GmailActionEvent,
  type GmailMessageView,
} from './types'

const GMAIL_RESPONSE_LIMIT_BYTES = 1024 * 1024
const DRAFT_RESPONSE_LIMIT_BYTES = 64 * 1024
const MAX_CARD_BODY_CHARS = 6_000
const MAX_DECODED_PART_BYTES = 512 * 1024
const MAX_MIME_PARTS = 100
const MAX_MIME_DEPTH = 20
const MAX_FILENAME_CHARS = 1_024
const MAX_DRAFT_BODY_CHARS = 5_000
const MAX_HEADER_CHARS = 998
const MAILBOX = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i
const MESSAGE_ID = /^<[^<>\s@]+@[^<>\s@]+>$/
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { data?: string }
  headers?: Array<{ name: string; value: string }>
  parts?: GmailPart[]
}

export class GmailApiError extends Phase0Error {
  constructor(code: string, upstreamStatus?: number) {
    super(code, { status: 502, upstreamStatus, cardSafe: true })
    this.name = 'GmailApiError'
  }
}

function boundedString(value: unknown, code: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || CONTROL_CHAR.test(value)) {
    throw new GmailApiError(code)
  }
  return value
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_DECODED_PART_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9_-]*={0,2}$/.test(value)) {
    throw new GmailApiError('gmail_message_part_invalid')
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new GmailApiError('gmail_message_part_invalid')
  }
  if (binary.length > MAX_DECODED_PART_BYTES) throw new GmailApiError('gmail_message_part_too_large')
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function partCharset(part: GmailPart): string {
  const contentType = part.headers
    ?.find((header) => header.name.toLowerCase() === 'content-type')
    ?.value ?? ''
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)
  return match?.[1]?.toLowerCase() ?? 'utf-8'
}

function decodePart(part: GmailPart): string {
  const data = part.body?.data
  if (!data) return ''
  const bytes = decodeBase64Url(data)
  try {
    return new TextDecoder(partCharset(part), { fatal: false, ignoreBOM: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
  }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseHeaders(value: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(value) || value.length > 200) throw new GmailApiError('gmail_headers_invalid')
  return value.map((header) => {
    if (!isRecord(header)) throw new GmailApiError('gmail_headers_invalid')
    if (
      typeof header.value !== 'string'
      || header.value.length > 8_192
      || CONTROL_CHAR.test(header.value)
    ) {
      throw new GmailApiError('gmail_headers_invalid')
    }
    return {
      name: boundedString(header.name, 'gmail_headers_invalid', 100),
      value: header.value,
    }
  })
}

function parsePart(value: unknown, depth: number, count: { value: number }): GmailPart {
  if (!isRecord(value) || depth > MAX_MIME_DEPTH || ++count.value > MAX_MIME_PARTS) {
    throw new GmailApiError('gmail_mime_structure_invalid')
  }
  const part: GmailPart = {}
  if (value.mimeType !== undefined) {
    part.mimeType = boundedString(value.mimeType, 'gmail_mime_structure_invalid', 200)
  }
  if (value.filename !== undefined) {
    if (
      typeof value.filename !== 'string'
      || value.filename.length > MAX_FILENAME_CHARS
      || CONTROL_CHAR.test(value.filename)
    ) {
      throw new GmailApiError('gmail_mime_structure_invalid')
    }
    part.filename = value.filename
  }
  if (value.body !== undefined) {
    if (!isRecord(value.body)) throw new GmailApiError('gmail_mime_structure_invalid')
    if (value.body.data !== undefined) {
      if (typeof value.body.data !== 'string') throw new GmailApiError('gmail_mime_structure_invalid')
      part.body = { data: value.body.data }
    }
  }
  if (value.headers !== undefined) part.headers = parseHeaders(value.headers)
  if (value.parts !== undefined) {
    if (!Array.isArray(value.parts)) throw new GmailApiError('gmail_mime_structure_invalid')
    part.parts = value.parts.map((child) => parsePart(child, depth + 1, count))
  }
  return part
}

function isAttachmentPart(part: GmailPart): boolean {
  if (part.filename !== undefined && part.filename.length > 0) return true
  const disposition = part.headers
    ?.find((header) => header.name.toLowerCase() === 'content-disposition')
    ?.value ?? ''
  return /^\s*attachment(?:\s*;|\s*$)/i.test(disposition)
    || /(?:^|;)\s*filename\*?\s*=/i.test(disposition)
}

function collectBodyCandidates(part: GmailPart, plain: string[], html: string[]): void {
  // A text attachment is still an attachment. Skip the entire subtree before
  // decoding so its bytes can never become card content or a future AI input.
  if (isAttachmentPart(part)) return
  const mimeType = part.mimeType?.toLowerCase()
  if (mimeType === 'text/plain' && part.body?.data) plain.push(decodePart(part))
  if (mimeType === 'text/html' && part.body?.data) html.push(decodePart(part))
  for (const child of part.parts ?? []) collectBodyCandidates(child, plain, html)
}

function cleanDisplayHeader(value: string | undefined, maxLength: number): string {
  return (value ?? '').replace(CONTROL_CHAR, ' ').trim().slice(0, maxLength)
}

function parseMessage(data: Record<string, unknown>): GmailMessageView {
  const id = boundedString(data.id, 'gmail_message_id_invalid', 256)
  const threadId = boundedString(data.threadId, 'gmail_thread_id_invalid', 256)
  if (!isRecord(data.payload)) throw new GmailApiError('gmail_payload_invalid')
  const root = parsePart(data.payload, 0, { value: 0 })
  const headers = root.headers ?? []
  const header = (name: string): string | undefined => (
    headers.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.value
  )

  const plain: string[] = []
  const html: string[] = []
  collectBodyCandidates(root, plain, html)
  const snippet = typeof data.snippet === 'string' ? data.snippet : ''
  const body = plain.join('\n').trim() || htmlToPlainText(html.join('\n')) || snippet
  const bodyTruncated = body.length > MAX_CARD_BODY_CHARS

  return {
    id,
    threadId,
    from: cleanDisplayHeader(header('From'), 500),
    subject: cleanDisplayHeader(header('Subject'), 500),
    messageIdHeader: cleanDisplayHeader(header('Message-ID'), 500) || undefined,
    body: body.slice(0, MAX_CARD_BODY_CHARS),
    bodyTruncated,
  }
}

export async function readCurrentMessage(
  event: GmailActionEvent,
  fetcher: FetchLike,
  signal: AbortSignal,
): Promise<GmailMessageView> {
  const headers = gmailContextHeaders(event)
  headers.set('Accept', 'application/json')
  const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(event.gmail.messageId)}?format=full`
  const response = await fetcher(endpoint, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new GmailApiError('gmail_read_rejected', response.status)

  try {
    return parseMessage(await readBoundedResponseJson(response, GMAIL_RESPONSE_LIMIT_BYTES))
  } catch (error) {
    if (error instanceof GmailApiError) throw error
    throw new GmailApiError('gmail_read_response_invalid', response.status)
  }
}

function extractMailbox(from: string): string {
  if (CONTROL_CHAR.test(from) || from.length > 500) throw new GmailApiError('gmail_reply_recipient_invalid')
  const bracketed = /<([^<>]+)>/.exec(from)?.[1]?.trim()
  const candidate = bracketed ?? from.trim()
  if (!MAILBOX.test(candidate)) throw new GmailApiError('gmail_reply_recipient_invalid')
  return candidate
}

function safeHeader(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_HEADER_CHARS || CONTROL_CHAR.test(normalized)) {
    throw new GmailApiError(code)
  }
  return normalized
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function buildReplyMime(message: GmailMessageView, body: string): string {
  const recipient = extractMailbox(message.from)
  const originalSubject = safeHeader(message.subject || '(Sans objet)', 'gmail_reply_subject_invalid')
  const subject = safeHeader(
    /^re\s*:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`,
    'gmail_reply_subject_invalid',
  )
  const messageId = safeHeader(message.messageIdHeader ?? '', 'gmail_reply_message_id_missing')
  if (!MESSAGE_ID.test(messageId)) throw new GmailApiError('gmail_reply_message_id_invalid')
  if (!body.trim() || body.length > MAX_DRAFT_BODY_CHARS || body.includes('\u0000')) {
    throw new GmailApiError('gmail_reply_body_invalid')
  }
  const normalizedBody = body.replace(/\r?\n/g, '\r\n')
  return [
    `To: ${recipient}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedBody,
  ].join('\r\n')
}

export async function createReplyDraft(
  event: GmailActionEvent,
  message: GmailMessageView,
  body: string,
  fetcher: FetchLike,
  signal: AbortSignal,
): Promise<CreatedDraft> {
  const headers = gmailContextHeaders(event)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json; charset=utf-8')
  const raw = encodeBase64Url(buildReplyMime(message, body))
  const response = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers,
    redirect: 'error',
    signal,
    body: JSON.stringify({ message: { raw, threadId: message.threadId } }),
  })
  if (!response.ok) throw new GmailApiError('gmail_draft_create_rejected', response.status)

  let result: Record<string, unknown>
  try {
    result = await readBoundedResponseJson(response, DRAFT_RESPONSE_LIMIT_BYTES)
  } catch {
    throw new GmailApiError('gmail_draft_response_invalid', response.status)
  }
  const draftId = boundedString(result.id, 'gmail_draft_id_invalid', 256)
  if (!isRecord(result.message)) throw new GmailApiError('gmail_draft_message_invalid', response.status)
  const threadId = boundedString(result.message.threadId, 'gmail_draft_thread_invalid', 256)
  if (threadId !== message.threadId) {
    throw new GmailApiError('gmail_draft_thread_mismatch', response.status)
  }
  return { draftId, threadId }
}
