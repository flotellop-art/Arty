// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  buildContextCard,
  buildDraftHostAction,
  renderCard,
} from '../../../functions/api/workspace-addon/phase0/_lib/cards'
import {
  gmailContextHeaders,
  parseWorkspaceEvent,
  requireAuthorizedScopes,
  requireGmailActionContext,
} from '../../../functions/api/workspace-addon/phase0/_lib/event'
import {
  createReplyDraft,
  readCurrentMessage,
} from '../../../functions/api/workspace-addon/phase0/_lib/gmail'
import { readBoundedJson } from '../../../functions/api/workspace-addon/phase0/_lib/http'
import {
  Phase0Error,
  type FetchLike,
  type GmailActionEvent,
  type Phase0Config,
} from '../../../functions/api/workspace-addon/phase0/_lib/types'

const MESSAGE_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.message.action'
const COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.action.compose'

const config: Phase0Config = {
  baseUrl: 'https://tryarty.com',
  oauthClientId: 'addon-client.apps.googleusercontent.com',
  serviceAccountEmail: 'workspace-addon@example.iam.gserviceaccount.com',
  hostActionShape: 'rpc',
}

function rawEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commonEventObject: { hostApp: 'GMAIL', platform: 'WEB' },
    authorizationEventObject: {
      systemIdToken: 'system.payload.signature',
      userIdToken: 'user.payload.signature',
      userOAuthToken: 'ya29.user-oauth-token',
      authorizedScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', MESSAGE_SCOPE, COMPOSE_SCOPE],
    },
    gmail: {
      messageId: 'msg-f:current-123',
      threadId: 'thread-f:current-456',
      accessToken: 'gmail-context-token',
    },
    ...overrides,
  }
}

function actionEvent(): GmailActionEvent {
  return requireGmailActionContext(parseWorkspaceEvent(rawEvent()))
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

describe('Workspace Add-on Phase 0 event boundary', () => {
  it('normalizes the historical ANDRIOD spelling and accepts only the event Gmail context', () => {
    const event = parseWorkspaceEvent(rawEvent({
      commonEventObject: { hostApp: 'GMAIL', platform: 'ANDRIOD' },
    }))

    expect(event.commonEventObject.platform).toBe('ANDROID')
    expect(requireGmailActionContext(event).gmail.messageId).toBe('msg-f:current-123')
  })

  it('requires the complete contextual token pair and exact scopes', () => {
    const missingGmailToken = parseWorkspaceEvent(rawEvent({
      gmail: { messageId: 'msg-f:current-123', threadId: 'thread-f:current-456' },
    }))
    expect(() => requireGmailActionContext(missingGmailToken)).toThrowError(
      expect.objectContaining({ code: 'gmail_context_token_pair_missing' }),
    )

    const event = parseWorkspaceEvent(rawEvent())
    expect(() => requireAuthorizedScopes(event, [MESSAGE_SCOPE, COMPOSE_SCOPE])).not.toThrow()
    expect(() => requireAuthorizedScopes(event, ['https://example.test/missing'])).toThrowError(
      expect.objectContaining({ code: 'workspace_scopes_missing' }),
    )
  })

  it('builds both Gmail context headers and never substitutes one for the other', () => {
    const headers = gmailContextHeaders(actionEvent())
    expect(headers.get('Authorization')).toBe('Bearer ya29.user-oauth-token')
    expect(headers.get('X-Goog-Gmail-Access-Token')).toBe('gmail-context-token')
  })
})

describe('Workspace Add-on Phase 0 cards', () => {
  it('renders a context card with explicit read and draft actions but no message content', () => {
    const json = JSON.stringify(renderCard(buildContextCard(config, 'phase0-test-nonce-123456')))
    expect(json).toContain('/api/workspace-addon/phase0/read')
    expect(json).toContain('/api/workspace-addon/phase0/create-draft')
    expect(json).toContain('pas encore été demandé')
    expect(json).toContain('phase0_action_nonce')
    expect(json).toContain('phase0_reply_body')
    expect(json).toContain('SPINNER')
    expect(json).not.toContain('msg-f:current-123')
  })

  it('supports the two official HTTP response shapes without mixing their fields', () => {
    expect(buildDraftHostAction('rpc', 'r-123', 'thread-f:456', 'api-thread-unused')).toEqual({
      renderActions: {
        hostAppAction: {
          gmailAction: {
            openCreatedDraftAction: {
              draftId: 'msg-a:r-123',
              threadServerPermId: 'thread-f:456',
            },
          },
        },
      },
    })
    expect(buildDraftHostAction('legacy', 'r-123', 'thread-f-unused', 'abc456')).toEqual({
      renderActions: {
        hostAppAction: {
          gmailAction: {
            openCreatedDraftActionMarkup: {
              draftId: 'r-123',
              draftThreadId: 'abc456',
            },
          },
        },
      },
    })
  })
})

describe('Workspace Add-on Phase 0 Gmail probe', () => {
  it('reads only the event message with both temporary tokens', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(Response.json({
      id: 'api-message-123',
      threadId: 'api-thread-456',
      snippet: 'fallback',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Paul Exemple <paul@example.com>' },
          { name: 'Subject', value: 'Devis juin' },
          { name: 'Message-ID', value: '<message-123@example.com>' },
          { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
        ],
        body: { data: base64Url('Bonjour, voici le devis demandé.') },
      },
    }))

    const message = await readCurrentMessage(actionEvent(), fetcher, AbortSignal.timeout(1_000))

    expect(message).toMatchObject({
      id: 'api-message-123',
      threadId: 'api-thread-456',
      from: 'Paul Exemple <paul@example.com>',
      subject: 'Devis juin',
      body: 'Bonjour, voici le devis demandé.',
      bodyTruncated: false,
    })
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toContain('/messages/msg-f%3Acurrent-123?format=full')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer ya29.user-oauth-token')
    expect(headers.get('X-Goog-Gmail-Access-Token')).toBe('gmail-context-token')
  })

  it('excludes text attachments identified by filename or Content-Disposition', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(Response.json({
      id: 'api-message-with-attachments',
      threadId: 'api-thread-456',
      payload: {
        mimeType: 'multipart/mixed',
        filename: '',
        headers: [
          { name: 'From', value: 'Paul Exemple <paul@example.com>' },
          { name: 'Subject', value: 'Message avec pièces jointes' },
          { name: 'Message-ID', value: '<message-attachments@example.com>' },
        ],
        parts: [
          {
            mimeType: 'text/html',
            filename: '',
            headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body: { data: base64Url('<p>Corps principal uniquement.</p>') },
          },
          {
            mimeType: 'text/plain',
            filename: 'confidentiel.txt',
            headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
            body: { data: base64Url('SECRET DE LA PIECE JOINTE TEXTE') },
          },
          {
            mimeType: 'text/html',
            filename: '',
            headers: [
              { name: 'Content-Type', value: 'text/html; charset=utf-8' },
              { name: 'Content-Disposition', value: 'attachment; filename="confidentiel.html"' },
            ],
            body: { data: base64Url('<p>SECRET DE LA PIECE JOINTE HTML</p>') },
          },
        ],
      },
    }))

    const message = await readCurrentMessage(actionEvent(), fetcher, AbortSignal.timeout(1_000))

    expect(message.body).toBe('Corps principal uniquement.')
    expect(message.body).not.toContain('SECRET')
  })

  it('creates a reply draft in the API thread without any send call', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(Response.json({
      id: 'r-123',
      message: { threadId: 'api-thread-456' },
    }))
    const message = {
      id: 'api-message-123',
      threadId: 'api-thread-456',
      from: 'Paul Exemple <paul@example.com>',
      subject: 'Devis juin',
      messageIdHeader: '<message-123@example.com>',
      body: 'Message',
      bodyTruncated: false,
    }

    const result = await createReplyDraft(
      actionEvent(),
      message,
      'Bonjour Paul,\n\nMerci pour votre message.',
      fetcher,
      AbortSignal.timeout(1_000),
    )

    expect(result).toEqual({ draftId: 'r-123', threadId: 'api-thread-456' })
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer ya29.user-oauth-token')
    expect(headers.get('X-Goog-Gmail-Access-Token')).toBe('gmail-context-token')
    const body = JSON.parse(String(init?.body)) as { message: { raw: string; threadId: string } }
    expect(body.message.threadId).toBe('api-thread-456')
    const mime = decodeBase64Url(body.message.raw)
    expect(mime).toContain('To: paul@example.com\r\n')
    expect(mime).toContain('Subject: Re: Devis juin\r\n')
    expect(mime).toContain('In-Reply-To: <message-123@example.com>\r\n')
    expect(mime).not.toContain('Bcc:')
  })

  it('rejects a response larger than the configured bound before parsing it', async () => {
    const request = new Request('https://tryarty.com/api/workspace-addon/phase0/home', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(256) }),
    })

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject<Partial<Phase0Error>>({
      code: 'request_body_too_large',
      status: 413,
    })
  })

  it('accepts JSON parameters but rejects lookalike media types', async () => {
    const accepted = new Request('https://tryarty.com/api/workspace-addon/phase0/home', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"ok":true}',
    })
    await expect(readBoundedJson(accepted)).resolves.toEqual({ ok: true })

    for (const contentType of ['application/jsonp', 'application/json-evil', 'text/plain']) {
      const rejected = new Request('https://tryarty.com/api/workspace-addon/phase0/home', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: '{}',
      })
      await expect(readBoundedJson(rejected)).rejects.toMatchObject({
        code: 'content_type_invalid',
        status: 415,
      })
    }
  })
})
