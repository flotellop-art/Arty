/** Authenticated server erasure first; local cleanup is resumable and always
 * bound to the identity captured before the first asynchronous operation. */
import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import { clearAllForActiveUser } from './scopedStorage'
import { getActiveUserId, getActiveSession, getActiveSessionEpoch, invalidateActiveSessionWork,
  removeKnownSession, clearActiveSession, purgeLegacyGlobalReports, type UserSession } from './userSession'
import { wipeFileStorage } from './secureFileStorage'
import { purgeMailAccountsForUser } from './mailAccounts'
import { getTrialToken } from './emailTrialClient'
import { beginProjectErasure, assertProjectErasure, confirmServerProjectErasure, finishProjectErasure,
  releaseFailedProjectErasure, markProjectErasureSent, readProjectErasureState, blockProjectOperations, purgeProjectsForAccount,
  type ProjectErasure, type ProjectErasureState } from './projects/store'
import { ACCOUNT_ERASURE_PATH, ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, ERASURE_SUBJECT_HEADER, createRemoteErasure } from './accountErasureProtocol'
import { readConfirmedErasureReceipt } from './accountErasureReceipt'
import { getDocumentStorageLayout, documentWorkspace } from './workspaceWriter/runtime'

export type AccountErasureOutcome = 'complete' | 'reload-required'

type AccountContext = { session: UserSession; assertCurrent(): void }
function captureAccount(): AccountContext {
  const active = getActiveSession()
  if (!active) throw new Error('No active account to delete')
  const session = { ...active }, epoch = getActiveSessionEpoch()
  return { session, assertCurrent() {
    if (getActiveUserId() !== session.userId || getActiveSessionEpoch() !== epoch) throw new Error('Account erasure context changed')
  } }
}
/** Opening Settings reads only local state. Failure is not 'no operation'. */
export async function getAccountErasureState(): Promise<ProjectErasureState> {
  const context = captureAccount()
  const state = await readProjectErasureState(context.session.userId, context.assertCurrent)
  return state === 'none' && ['apikey', 'demo'].includes(context.session.authMethod) ? 'local-only' : state
}
async function performServerErasure(context: AccountContext, lease: ProjectErasure): Promise<void> {
  context.assertCurrent()
  const { session } = context, intent = lease.remote
  if (!intent || lease.localOnly) throw new Error('Legacy erasure outcome unknown')
  const headers: Record<string, string> = { [ERASURE_OPERATION_HEADER]: lease.operationId, [ERASURE_CAPABILITY_HEADER]: intent.capability }
  let send = false
  if (intent.state === 'not-sent') {
    const auth: Record<string, string> = {}
    if (session.authMethod === 'google') {
      const token = await getValidAccessToken()
      context.assertCurrent()
      if (!token) throw new Error('Google credential unavailable for account deletion')
      auth['x-google-token'] = token
    } else {
      const token = getTrialToken()
      if (!token) throw new Error('Email credential unavailable for account deletion')
      auth['x-arty-trial-token'] = token
    }
    context.assertCurrent()
    send = await markProjectErasureSent(lease, context.assertCurrent)
    if (send) Object.assign(headers, auth, { [ERASURE_SUBJECT_HEADER]: intent.subjectHash })
  }
  context.assertCurrent()
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(apiUrl(ACCOUNT_ERASURE_PATH), { method: send ? 'POST' : 'GET', headers,
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal })
    await readConfirmedErasureReceipt(res, lease.operationId, intent.subjectHash)
    // The validated result belongs to A even after a UI switch. Its durable
    // receipt may be recorded; the caller must still refuse local cleanup of B.
  } finally { clearTimeout(timeout) }
}

async function performLocalErasure(captured: AccountContext, lease: ProjectErasure): Promise<AccountErasureOutcome> {
  captured.assertCurrent()
  await assertProjectErasure(lease, captured.assertCurrent)
  if (getDocumentStorageLayout().kind === 'isolated-v1') {
    // Durable authority stays in place. Never run the legacy, single-copy
    // cleaner or remove its receipt in this already-private document.
    captured.assertCurrent()
    invalidateActiveSessionWork()
    documentWorkspace.retire()
    return 'reload-required'
  }
  // Stop running conversation/file crypto work without dropping the identity
  // required for captured-owner cleanup. Retrying cleanup does not need crypto.
  invalidateActiveSessionWork()
  const context = captureAccount(), { userId, email } = context.session
  // Other windows check this durable membership at every project operation.
  // The temporary IDB marker also blocks a concurrent explicit re-login.
  removeKnownSession(userId)
  await purgeProjectsForAccount(userId, context.assertCurrent)
  await assertProjectErasure(lease, context.assertCurrent)
  await wipeFileStorage(userId)
  context.assertCurrent()
  await purgeMailAccountsForUser(userId)
  await assertProjectErasure(lease, context.assertCurrent)
  // No await in this final localStorage phase: never resolve ownership late.
  purgeLegacyGlobalReports()
  clearAllForActiveUser()
  if (email) localStorage.removeItem(`arty-email-hash-${email}`)
  removeKnownSession(userId)
  // The receipt is removed only after all identity-bearing local stores are
  // erased. A failed final IDB cleanup keeps the active identity for retry.
  await finishProjectErasure(lease)
  context.assertCurrent()
  clearActiveSession()
  return 'complete'
}

/** Explicit local-only erasure entry point; does not assume a 401 is success. */
export async function wipeLocalAccount(): Promise<AccountErasureOutcome> {
  const context = captureAccount(), release = blockProjectOperations(context.session.userId)
  try {
    const lease = await beginProjectErasure(context.session.userId, context.assertCurrent, true)
    return await performLocalErasure(context, lease)
  } finally { release() }
}

/** A confirmed server receipt survives reload and local failure. In particular,
 * email tokens are already revoked after success and must not be posted again. */
export async function deleteAccount(): Promise<AccountErasureOutcome> {
  const context = captureAccount()
  if (context.session.authMethod === 'apikey' || context.session.authMethod === 'demo') {
    return wipeLocalAccount()
  }
  const release = blockProjectOperations(context.session.userId)
  let lease: ProjectErasure | undefined, serverConfirmed = false
  try {
    const state = await readProjectErasureState(context.session.userId, context.assertCurrent)
    if (state === 'legacy-unknown' || state === 'local-only') throw new Error('Legacy erasure outcome unknown')
    const remote = state === 'none' ? await createRemoteErasure(context.session.authMethod === 'google' ? 'google' : 'email-trial', context.session.email ?? '') : undefined
    context.assertCurrent()
    lease = await beginProjectErasure(context.session.userId, context.assertCurrent, false, remote)
    serverConfirmed = lease.serverConfirmed
    if (!serverConfirmed) {
      await performServerErasure(context, lease)
      serverConfirmed = true
      await confirmServerProjectErasure(lease)
    }
    context.assertCurrent()
    return await performLocalErasure(context, lease)
  } catch (error) {
    // Release only provably not-sent work. The store MUST keep uncertain v1
    // receipts, including timeout, 401, 500 and failure to save a real success.
    if (lease && !serverConfirmed) await releaseFailedProjectErasure(lease).catch(() => {})
    throw error
  } finally { release() }
}
