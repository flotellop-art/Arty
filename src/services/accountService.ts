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
  releaseFailedProjectErasure, blockProjectOperations, purgeProjectsForAccount, type ProjectErasure } from './projects/store'

type AccountContext = { session: UserSession; assertCurrent(): void }
function captureAccount(): AccountContext {
  const active = getActiveSession()
  if (!active) throw new Error('No active account to delete')
  const session = { ...active }, epoch = getActiveSessionEpoch()
  return { session, assertCurrent() {
    if (getActiveUserId() !== session.userId || getActiveSessionEpoch() !== epoch) throw new Error('Account erasure context changed')
  } }
}
async function performServerErasure(context: AccountContext): Promise<void> {
  context.assertCurrent()
  const { session } = context
  if (session.authMethod === 'apikey' || session.authMethod === 'demo') return
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session.authMethod === 'google') {
    const token = await getValidAccessToken()
    // Refresh may have waited while the UI switched to another account.
    context.assertCurrent()
    if (!token) throw new Error('Google credential unavailable for account deletion')
    headers['x-google-token'] = token
  } else {
    const token = getTrialToken()
    if (!token) throw new Error('Email credential unavailable for account deletion')
    headers['x-arty-trial-token'] = token
  }
  context.assertCurrent()
  const res = await fetch(apiUrl('/api/account/delete'), { method: 'POST', headers })
  if (!res.ok) throw new Error(`account delete failed (${res.status})`)
  // A received success belongs to the token captured above, even if the UI
  // switched meanwhile. The caller may record that receipt for A, not wipe B.
}
export async function deleteServerAccount(): Promise<void> { await performServerErasure(captureAccount()) }

async function performLocalErasure(captured: AccountContext, lease: ProjectErasure): Promise<void> {
  captured.assertCurrent()
  await assertProjectErasure(lease, captured.assertCurrent)
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
}

/** Explicit local-only erasure entry point; does not assume a 401 is success. */
export async function wipeLocalAccount(): Promise<void> {
  const context = captureAccount(), release = blockProjectOperations(context.session.userId)
  try {
    const lease = await beginProjectErasure(context.session.userId, context.assertCurrent, true)
    await performLocalErasure(context, lease)
  } finally { release() }
}

/** A confirmed server receipt survives reload and local failure. In particular,
 * email tokens are already revoked after success and must not be posted again. */
export async function deleteAccount(): Promise<void> {
  const context = captureAccount(), release = blockProjectOperations(context.session.userId)
  let lease: ProjectErasure | undefined, serverConfirmed = false
  try {
    lease = await beginProjectErasure(context.session.userId, context.assertCurrent)
    serverConfirmed = lease.serverConfirmed
    if (!serverConfirmed) {
      await performServerErasure(context)
      serverConfirmed = true
      await confirmServerProjectErasure(lease)
    }
    context.assertCurrent()
    await performLocalErasure(context, lease)
  } catch (error) {
    // No server success: no local erasure was started. Release the temporary
    // marker; never clear a confirmed/potentially confirmed server receipt.
    if (lease && !serverConfirmed) await releaseFailedProjectErasure(lease).catch(() => {})
    throw error
  } finally { release() }
}
