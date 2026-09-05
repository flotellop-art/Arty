import { Capacitor } from '@capacitor/core'
import { getActiveUserId, getActiveSessionEpoch } from '../userSession'
import { mailPasswordCandidates } from '../mailPassword'
import { getMailImapPlugin } from './mailImapRegistration'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'
import { assertDocumentWorkspace } from '../workspaceWriter/runtime'

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

const MailImap = getMailImapPlugin<MailImapPluginApi>()

export function isMailImapAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function requireScope(): string {
  const userId = getActiveUserId()
  if (!userId) throw new Error('no_active_user')
  return userId
}

export async function addMailAccount(input: {
  provider: string
  label: string
  host: string
  email: string
  password: string
}): Promise<{ id: string; messageCount: number }> {
  const scope = requireScope()
  const epoch = getActiveSessionEpoch(), erasureGuard = captureOwnerErasureGuard(scope)
  const assertCurrent = () => {
    assertDocumentWorkspace(); erasureGuard()
    if (getActiveUserId() !== scope || getActiveSessionEpoch() !== epoch) throw new Error('mail_action_cancelled')
  }
  // BUG 66 : mot de passe normalisé d'abord (espaces du format Google 4×4,
  // espace final du clavier), puis le brut en filet sur échec d'auth — un
  // mot de passe légal contenant réellement des blancs reste connectable.
  const candidates = mailPasswordCandidates(input.password, input.host)
  let lastErr: unknown = null
  for (const password of candidates) {
    assertCurrent()
    try {
      const result = await MailImap.addAccount({ scope, ...input, password })
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
  const res = await MailImap.listAccounts({ scope: userId })
  return res.accounts ?? []
}

export async function removeMailAccount(id: string): Promise<void> {
  await MailImap.removeAccount({ scope: requireScope(), id })
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
  return MailImap.checkAccount({ scope: requireScope(), id })
}

export async function listMailFolders(id: string): Promise<string[]> {
  const res = await MailImap.listFolders({ scope: requireScope(), id })
  return (res.folders ?? []).map((f) => f.name)
}

export async function recentMailMessages(
  id: string,
  limit?: number,
  folder?: string
): Promise<{ messages: MailMessageSummary[]; total: number }> {
  return MailImap.recentMessages({ scope: requireScope(), id, limit, folder })
}

export async function searchMailMessages(
  id: string,
  query: string,
  limit?: number,
  folder?: string
): Promise<{ messages: MailMessageSummary[]; totalMatches: number }> {
  return MailImap.searchMessages({ scope: requireScope(), id, query, limit, folder })
}

export async function readMailMessage(
  id: string,
  uid: number,
  folder?: string
): Promise<MailMessageFull> {
  return MailImap.readMessage({ scope: requireScope(), id, uid, folder })
}
