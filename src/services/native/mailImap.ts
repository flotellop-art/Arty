import { Capacitor } from '@capacitor/core'
import { getActiveUserId, getActiveSessionEpoch } from '../userSession'
import { mailPasswordCandidates } from '../mailPassword'
import { getMailImapPlugin } from './mailImapRegistration'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'
import { assertDocumentWorkspace, getDocumentStorageLayout } from '../workspaceWriter/runtime'
import { readResetControl } from '../workspaceWriter/resetStore'

// Bridge vers le client IMAP natif LECTURE SEULE (MailImapPlugin.java).
// Architecture « natif d'abord » (décision du 9 août 2026) : le mot de passe
// d'application est chiffré dans l'Android Keystore, la connexion IMAP part
// du téléphone. Rien ne transite par les serveurs Arty. Le mot de passe ne
// traverse le JS qu'une seule fois, à l'ajout du compte, et n'est JAMAIS
// stocké côté JS ni loggé (RÈGLE 5).

export interface MailAccountMeta {
  id: string
  provider: string
  label: string
  email: string
  host: string
}

export interface MailMessageSummary {
  uid: number
  subject: string
  from: string
  date: string
}

export interface MailMessageFull extends MailMessageSummary {
  to: string
  body: string
}

interface MailImapPluginApi {
  addAccount(options: {
    scope: string
    provider: string
    label: string
    host: string
    email: string
    password: string
  }): Promise<{ id: string; messageCount: number }>
  listAccounts(options: { scope: string }): Promise<{ accounts: MailAccountMeta[] }>
  removeAccount(options: { scope: string; id: string }): Promise<void>
  clearAccounts(options: { scope: string }): Promise<void>
  checkAccount(options: { scope: string; id: string }): Promise<{
    ok: boolean
    messageCount: number
    unreadCount: number
  }>
  listFolders(options: { scope: string; id: string }): Promise<{ folders: { name: string }[] }>
  recentMessages(options: {
    scope: string
    id: string
    limit?: number
    folder?: string
  }): Promise<{ messages: MailMessageSummary[]; total: number }>
  searchMessages(options: {
    scope: string
    id: string
    query: string
    limit?: number
    folder?: string
  }): Promise<{ messages: MailMessageSummary[]; totalMatches: number }>
  readMessage(options: {
    scope: string
    id: string
    uid: number
    folder?: string
  }): Promise<MailMessageFull>
}

type MailScope = { scope: string; incarnation?: string }
type Incarnated<T> = { [K in keyof T]: T[K] extends (options: infer O) => infer R ? (options: O & { incarnation?: string }) => R : never }
const MailImap = getMailImapPlugin<Incarnated<MailImapPluginApi>>()

// A committed native mutation can outlive its UI opening or JS session epoch.
// Notify only the captured owner; this is cache invalidation, not permission
// to read that owner's storage or dispatch another native operation.
const accountChanges = new Set<(owner: string) => void>()
export function onNativeMailAccountsChanged(listener: (owner: string) => void) {
  accountChanges.add(listener)
  return () => { accountChanges.delete(listener) }
}
function accountsChanged(owner: string) {
  for (const listener of accountChanges) { try { listener(owner) } catch { /* observers cannot change native outcome */ } }
}

export function isMailImapAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function requireScope(): string {
  const userId = getActiveUserId()
  if (!userId) throw new Error('no_active_user')
  return userId
}

async function captureMail() {
  const scope = requireScope(), epoch = getActiveSessionEpoch(), erasure = captureOwnerErasureGuard(scope)
  const assertCurrent = () => {
    assertDocumentWorkspace(); erasure()
    if (getActiveUserId() !== scope || getActiveSessionEpoch() !== epoch) throw new Error('mail_action_cancelled')
  }
  assertCurrent()
  let incarnation: string | undefined
  if (getDocumentStorageLayout().kind === 'isolated-v1') {
    const control = await readResetControl(assertCurrent), record = control?.resets.find(r => r.owner === scope)
    if (record && record.phase !== 'consumed') throw new Error('mail_action_cancelled')
    incarnation = record?.resetId
  }
  assertCurrent()
  return { options: { scope, ...(incarnation ? { incarnation } : {}) } as MailScope, assertCurrent }
}
async function invoke<T>(call: (options: MailScope) => Promise<T>, changesAccounts = false): Promise<T> {
  const captured = await captureMail()
  captured.assertCurrent()
  try {
    let result: T
    try { result = await call(captured.options) }
    finally { if (changesAccounts) accountsChanged(captured.options.scope) }
    captured.assertCurrent(); return result
  }
  catch (error) { captured.assertCurrent(); throw error }
}

export async function addMailAccount(input: {
  provider: string
  label: string
  host: string
  email: string
  password: string
}): Promise<{ id: string; messageCount: number }> {
  const { options, assertCurrent } = await captureMail()
  // BUG 66 : mot de passe normalisé d'abord (espaces du format Google 4×4,
  // espace final du clavier), puis le brut en filet sur échec d'auth — un
  // mot de passe légal contenant réellement des blancs reste connectable.
  const candidates = mailPasswordCandidates(input.password, input.host)
  let lastErr: unknown = null
  for (const password of candidates) {
    assertCurrent()
    try {
      let result: { id: string; messageCount: number }
      try { result = await MailImap.addAccount({ provider: input.provider, label: input.label, host: input.host, email: input.email, password, ...options }) }
      finally { accountsChanged(options.scope) } // A rejected bridge reply cannot prove that no native write committed.
      assertCurrent()
      return result
    } catch (err) {
      assertCurrent()
      lastErr = err
      const code = err instanceof Error ? err.message : ''
      // Seul un refus d'authentification justifie d'essayer le candidat
      // suivant ; tout autre échec (réseau, quota, validation) remonte tel quel.
      if (!code.includes('auth_failed')) throw err
    }
  }
  throw lastErr
}

export async function listMailAccounts(): Promise<MailAccountMeta[]> {
  if (!isMailImapAvailable()) return []
  const userId = getActiveUserId()
  if (!userId) return []
  const res = await invoke(options => MailImap.listAccounts(options))
  return res.accounts ?? []
}

export async function removeMailAccount(id: string): Promise<void> {
  await invoke(options => MailImap.removeAccount({ ...options, id }), true)
}

/**
 * Purge tous les comptes du user Arty donné — chemin SUPPRESSION DE COMPTE
 * (droit à l'effacement, RGPD art. 17). Le logout, lui, ne purge pas : le
 * stockage natif est scopé par userId, un autre compte ne peut donc pas voir
 * ces boîtes (même politique que les conversations).
 *
 * L'erreur est PROPAGÉE volontairement. Un échec silencieux ici ferait dire à
 * l'application « compte supprimé » alors que l'adresse, le serveur et le mot
 * de passe chiffré resteraient sur l'appareil — et l'identifiant utilisateur
 * étant déterministe (dérivé du hachage de l'e-mail), une reconnexion
 * ultérieure les ferait réapparaître. Mieux vaut un échec visible et une
 * nouvelle tentative qu'une promesse d'effacement non tenue.
 */
export async function clearMailAccountsForUser(userId: string): Promise<void> {
  if (!isMailImapAvailable()) return
  await MailImap.clearAccounts({ scope: userId })
}

export async function checkMailAccount(id: string): Promise<{
  ok: boolean
  messageCount: number
  unreadCount: number
}> {
  return invoke(options => MailImap.checkAccount({ ...options, id }))
}

export async function listMailFolders(id: string): Promise<string[]> {
  const res = await invoke(options => MailImap.listFolders({ ...options, id }))
  return (res.folders ?? []).map((f) => f.name)
}

export async function recentMailMessages(
  id: string,
  limit?: number,
  folder?: string
): Promise<{ messages: MailMessageSummary[]; total: number }> {
  return invoke(options => MailImap.recentMessages({ ...options, id, limit, folder }))
}

export async function searchMailMessages(
  id: string,
  query: string,
  limit?: number,
  folder?: string
): Promise<{ messages: MailMessageSummary[]; totalMatches: number }> {
  return invoke(options => MailImap.searchMessages({ ...options, id, query, limit, folder }))
}

export async function readMailMessage(
  id: string,
  uid: number,
  folder?: string
): Promise<MailMessageFull> {
  return invoke(options => MailImap.readMessage({ ...options, id, uid, folder }))
}
