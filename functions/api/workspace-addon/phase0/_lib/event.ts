import {
  MissingScopesError,
  Phase0Error,
  isRecord,
  type GmailActionEvent,
  type GmailContextCredentials,
  type GmailContextEvent,
  type WorkspaceAuthorizationEvent,
  type WorkspaceCommonEvent,
  type WorkspaceGmailEvent,
  type WorkspaceHttpEvent,
  type WorkspacePlatform,
} from './types'

const MAX_JWT_CHARS = 16 * 1024
const MAX_TOKEN_CHARS = 16 * 1024
const MAX_SCOPE_CHARS = 512
const MAX_SCOPES = 64
const MAX_GMAIL_ID_CHARS = 256
const MAX_REPLY_BODY_CHARS = 5_000
const ACTION_NONCE = /^[A-Za-z0-9_-]{16,128}$/
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const GMAIL_ID_SHAPE = /^[A-Za-z0-9:._-]+$/
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

function requiredRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  if (!isRecord(value)) throw new Phase0Error(`event_${key}_invalid`, { status: 400 })
  return value
}

function requiredString(
  parent: Record<string, unknown>,
  key: string,
  maxLength: number,
  code: string,
): string {
  const value = parent[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || CONTROL_CHAR.test(value)) {
    throw new Phase0Error(code, { status: 400 })
  }
  return value
}

function optionalOpaqueToken(parent: Record<string, unknown>, key: string): string | undefined {
  const value = parent[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TOKEN_CHARS || /\s/.test(value)) {
    throw new Phase0Error(`event_${key}_invalid`, { status: 400 })
  }
  return value
}

function requiredJwt(parent: Record<string, unknown>, key: string): string {
  const value = requiredString(parent, key, MAX_JWT_CHARS, `event_${key}_invalid`)
  if (!JWT_SHAPE.test(value)) throw new Phase0Error(`event_${key}_invalid`, { status: 400 })
  return value
}

function optionalJwt(parent: Record<string, unknown>, key: string): string | undefined {
  if (parent[key] === undefined) return undefined
  return requiredJwt(parent, key)
}

function parsePlatform(value: unknown): WorkspacePlatform {
  if (value === 'WEB' || value === 'IOS' || value === 'ANDROID') return value
  // The embedded alternate-runtime schema historically contained this typo.
  // It is accepted explicitly and normalized; no other platform alias is used.
  if (value === 'ANDRIOD') return 'ANDROID'
  throw new Phase0Error('event_platform_invalid', { status: 400 })
}

function parseReplyBody(common: Record<string, unknown>): string | undefined {
  const formInputs = common.formInputs
  if (formInputs === undefined) return undefined
  if (!isRecord(formInputs)) throw new Phase0Error('event_form_inputs_invalid', { status: 400 })

  const replyInput = formInputs.phase0_reply_body
  if (replyInput === undefined) return undefined
  if (!isRecord(replyInput)) throw new Phase0Error('event_reply_body_invalid', { status: 400 })
  const stringInputs = replyInput.stringInputs
  if (!isRecord(stringInputs)) throw new Phase0Error('event_reply_body_invalid', { status: 400 })
  const values = stringInputs.value
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') {
    throw new Phase0Error('event_reply_body_invalid', { status: 400 })
  }
  const body = values[0]
  if (body.length > MAX_REPLY_BODY_CHARS || body.includes('\u0000')) {
    throw new Phase0Error('event_reply_body_invalid', { status: 400 })
  }
  return body
}

function parseActionNonce(common: Record<string, unknown>): string | undefined {
  const parameters = common.parameters
  if (parameters === undefined) return undefined
  if (!isRecord(parameters)) throw new Phase0Error('event_parameters_invalid', { status: 400 })
  const nonce = parameters.phase0_action_nonce
  if (nonce === undefined) return undefined
  if (typeof nonce !== 'string' || !ACTION_NONCE.test(nonce)) {
    throw new Phase0Error('event_action_nonce_invalid', { status: 400 })
  }
  return nonce
}

function parseCommonEvent(root: Record<string, unknown>): WorkspaceCommonEvent {
  const common = requiredRecord(root, 'commonEventObject')
  if (common.hostApp !== 'GMAIL') throw new Phase0Error('event_host_app_invalid', { status: 400 })
  return {
    hostApp: 'GMAIL',
    platform: parsePlatform(common.platform),
    replyBody: parseReplyBody(common),
    actionNonce: parseActionNonce(common),
  }
}

function parseAuthorizedScopes(value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_SCOPES) {
    throw new Phase0Error('event_authorized_scopes_invalid', { status: 400 })
  }
  const scopes: string[] = []
  for (const scope of value) {
    if (
      typeof scope !== 'string'
      || scope.length === 0
      || scope.length > MAX_SCOPE_CHARS
      || CONTROL_CHAR.test(scope)
    ) {
      throw new Phase0Error('event_authorized_scopes_invalid', { status: 400 })
    }
    if (!scopes.includes(scope)) scopes.push(scope)
  }
  return scopes
}

function parseAuthorizationEvent(root: Record<string, unknown>): WorkspaceAuthorizationEvent {
  const authorization = requiredRecord(root, 'authorizationEventObject')
  return {
    systemIdToken: requiredJwt(authorization, 'systemIdToken'),
    userIdToken: optionalJwt(authorization, 'userIdToken'),
    userOAuthToken: optionalOpaqueToken(authorization, 'userOAuthToken'),
    authorizedScopes: parseAuthorizedScopes(authorization.authorizedScopes),
  }
}

export function requireActionNonce(event: WorkspaceHttpEvent): string {
  const nonce = event.commonEventObject.actionNonce
  if (!nonce) throw new Phase0Error('phase0_action_nonce_required', { status: 400, cardSafe: true })
  return nonce
}

function parseGmailEvent(value: unknown): WorkspaceGmailEvent | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Phase0Error('event_gmail_invalid', { status: 400 })
  const messageId = requiredString(value, 'messageId', MAX_GMAIL_ID_CHARS, 'event_message_id_invalid')
  const threadId = requiredString(value, 'threadId', MAX_GMAIL_ID_CHARS, 'event_thread_id_invalid')
  if (!GMAIL_ID_SHAPE.test(messageId) || !GMAIL_ID_SHAPE.test(threadId)) {
    throw new Phase0Error('event_gmail_id_invalid', { status: 400 })
  }
  return {
    messageId,
    threadId,
    accessToken: optionalOpaqueToken(value, 'accessToken'),
  }
}

export function parseWorkspaceEvent(raw: unknown): WorkspaceHttpEvent {
  if (!isRecord(raw)) throw new Phase0Error('workspace_event_invalid', { status: 400 })
  return {
    commonEventObject: parseCommonEvent(raw),
    authorizationEventObject: parseAuthorizationEvent(raw),
    gmail: parseGmailEvent(raw.gmail),
  }
}

export function requireGmailContext(event: WorkspaceHttpEvent): GmailContextEvent {
  if (!event.gmail) throw new Phase0Error('gmail_context_missing', { status: 400 })
  return { ...event, gmail: event.gmail }
}

export function requireGmailActionContext(event: WorkspaceHttpEvent): GmailActionEvent {
  const contextual = requireGmailContext(event)
  const userOAuthToken = contextual.authorizationEventObject.userOAuthToken
  const accessToken = contextual.gmail.accessToken
  if (!userOAuthToken || !accessToken) {
    throw new Phase0Error('gmail_context_token_pair_missing', { status: 401 })
  }
  return {
    ...contextual,
    authorizationEventObject: { ...contextual.authorizationEventObject, userOAuthToken },
    gmail: { ...contextual.gmail, accessToken },
  }
}

export function requireAuthorizedScopes(
  event: WorkspaceHttpEvent,
  requiredScopes: readonly string[],
): void {
  const granted = new Set(event.authorizationEventObject.authorizedScopes)
  const missing = requiredScopes.filter((scope) => !granted.has(scope))
  if (missing.length > 0) throw new MissingScopesError(missing)
}

export function gmailContextHeaders(event: GmailActionEvent): Headers {
  const credentials: GmailContextCredentials = {
    userOAuthToken: event.authorizationEventObject.userOAuthToken,
    gmailAccessToken: event.gmail.accessToken,
  }
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${credentials.userOAuthToken}`)
  headers.set('X-Goog-Gmail-Access-Token', credentials.gmailAccessToken)
  return headers
}
