import { Capacitor, registerPlugin } from '@capacitor/core'
import { getActiveUserId } from '../userSession'

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

const MailImap = registerPlugin<MailImapPluginApi>('MailImap')

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
  return MailImap.addAccount({ scope: requireScope(), ...input })
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

/** Purge tous les comptes du user Arty donné (logout / suppression de compte). */
export async function clearMailAccountsForUser(userId: string): Promise<void> {
  if (!isMailImapAvailable()) return
  try {
    await MailImap.clearAccounts({ scope: userId })
  } catch {
    // Best-effort : un échec de purge native ne doit pas bloquer le logout.
  }
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
