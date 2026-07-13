import { buildDraftHostAction } from './_lib/cards'
import {
  parseWorkspaceEvent,
  requireActionNonce,
  requireGmailActionContext,
  requireGmailContext,
} from './_lib/event'
import { createReplyDraft, readCurrentMessage } from './_lib/gmail'
import {
  completePhase0Idempotency,
  reservePhase0Idempotency,
} from './_lib/idempotency'
import { createPhase0Handler, type Phase0HandlerContext } from './_lib/runtime'
import { Phase0Error, type GmailContextEvent } from './_lib/types'

const CURRENT_MESSAGE_ACTION_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.message.action'
const CURRENT_ACTION_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.action.compose'

export async function handleCreateDraft(
  { event, env, identity, fetcher, signal, config }: Phase0HandlerContext<GmailContextEvent>,
): Promise<unknown> {
  const replyBody = event.commonEventObject.replyBody
  if (!replyBody?.trim()) {
    throw new Phase0Error('phase0_reply_body_required', { status: 400, cardSafe: true })
  }
  const actionNonce = requireActionNonce(event)
  const actionEvent = requireGmailActionContext(event)
  const idempotencyDb = env.WORKSPACE_ADDON_PHASE0_DB
  if (!idempotencyDb) {
    throw new Phase0Error('phase0_idempotency_db_missing', { status: 503, cardSafe: true })
  }
  // Reserve before reading Gmail. A completed replay can reuse the stored
  // result without touching the message again, and any D1 failure stays ahead
  // of the contextual read as well as the draft side effect.
  const reservation = await reservePhase0Idempotency(idempotencyDb, {
    userSub: identity.user.subject,
    messageId: actionEvent.gmail.messageId,
    nonce: actionNonce,
  })
  if (reservation.status === 'pending' || reservation.status === 'blocked') {
    throw new Phase0Error(
      reservation.status === 'pending'
        ? 'phase0_draft_attempt_pending'
        : 'phase0_draft_attempt_already_finalized',
      { status: 409, cardSafe: true },
    )
  }
  if (reservation.status === 'completed') {
    return buildDraftHostAction(
      config.hostActionShape,
      reservation.draftId,
      actionEvent.gmail.threadId,
      reservation.threadId,
    )
  }
  // Only the owner of a fresh reservation may read the message and attempt the
  // draft. Its API threadId and RFC Message-ID constrain that single attempt.
  const message = await readCurrentMessage(actionEvent, fetcher, signal)
  const draft = await createReplyDraft(actionEvent, message, replyBody, fetcher, signal)
  const completed = await completePhase0Idempotency(idempotencyDb, reservation, draft)
  return buildDraftHostAction(
    config.hostActionShape,
    completed.draftId,
    actionEvent.gmail.threadId,
    completed.threadId,
  )
}

export const onRequestPost = createPhase0Handler({
  route: 'create-draft',
  parseEvent: (raw) => requireGmailContext(parseWorkspaceEvent(raw)),
  requiredScopes: [CURRENT_MESSAGE_ACTION_SCOPE, CURRENT_ACTION_COMPOSE_SCOPE],
  handle: handleCreateDraft,
})
