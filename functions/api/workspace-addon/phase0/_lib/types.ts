export const PHASE0_ROUTE_PATHS = {
  home: '/api/workspace-addon/phase0/home',
  context: '/api/workspace-addon/phase0/context',
  read: '/api/workspace-addon/phase0/read',
  'create-draft': '/api/workspace-addon/phase0/create-draft',
} as const

export type Phase0RouteName = keyof typeof PHASE0_ROUTE_PATHS
export type HostActionShape = 'rpc' | 'legacy'
export type WorkspacePlatform = 'WEB' | 'ANDROID' | 'IOS'

export interface WorkspaceCommonEvent {
  hostApp: 'GMAIL'
  platform: WorkspacePlatform
  replyBody?: string
  actionNonce?: string
}

export interface WorkspaceAuthorizationEvent {
  systemIdToken: string
  userIdToken?: string
  userOAuthToken?: string
  authorizedScopes: readonly string[]
}

export interface WorkspaceGmailEvent {
  messageId: string
  threadId: string
  accessToken?: string
}

export interface WorkspaceHttpEvent {
  commonEventObject: WorkspaceCommonEvent
  authorizationEventObject: WorkspaceAuthorizationEvent
  gmail?: WorkspaceGmailEvent
}

export interface GmailContextEvent extends WorkspaceHttpEvent {
  gmail: WorkspaceGmailEvent
}

export interface GmailActionEvent extends GmailContextEvent {
  authorizationEventObject: WorkspaceAuthorizationEvent & { userOAuthToken: string }
  gmail: WorkspaceGmailEvent & { accessToken: string }
}

export interface GmailContextCredentials {
  userOAuthToken: string
  gmailAccessToken: string
}

export interface VerifiedSystemIdentity {
  readonly issuer: string
  readonly subject: string
  readonly email: string
  readonly audience: string
}

export interface VerifiedUserIdentity {
  readonly issuer: string
  readonly subject: string
  readonly email: string
  readonly audience: string
}

export interface VerifiedWorkspaceRequest {
  readonly system: VerifiedSystemIdentity
  readonly user: VerifiedUserIdentity
}

export function freezeVerifiedWorkspaceRequest(
  system: VerifiedSystemIdentity,
  user: VerifiedUserIdentity,
): VerifiedWorkspaceRequest {
  return Object.freeze({
    system: Object.freeze({ ...system }),
    user: Object.freeze({ ...user }),
  })
}

export interface Phase0Config {
  baseUrl: string
  oauthClientId: string
  serviceAccountEmail: string
  hostActionShape: HostActionShape
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface GmailMessageView {
  id: string
  threadId: string
  from: string
  subject: string
  messageIdHeader?: string
  body: string
  bodyTruncated: boolean
}

export interface CreatedDraft {
  draftId: string
  threadId: string
}

export interface Phase0ErrorOptions {
  status?: number
  upstreamStatus?: number
  cardSafe?: boolean
}

export class Phase0Error extends Error {
  readonly code: string
  readonly status: number
  readonly upstreamStatus?: number
  readonly cardSafe: boolean

  constructor(code: string, options: Phase0ErrorOptions = {}) {
    super(code)
    this.name = 'Phase0Error'
    this.code = code
    this.status = options.status ?? 400
    this.upstreamStatus = options.upstreamStatus
    this.cardSafe = options.cardSafe ?? false
  }
}

export class MissingScopesError extends Phase0Error {
  readonly scopes: readonly string[]

  constructor(scopes: readonly string[]) {
    super('workspace_scopes_missing', { status: 403 })
    this.name = 'MissingScopesError'
    this.scopes = scopes
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
