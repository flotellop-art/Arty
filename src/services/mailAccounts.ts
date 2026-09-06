import {
  isMailImapAvailable,
  listMailAccounts,
  clearMailAccountsForUser,
  type MailAccountMeta,
} from './native/mailImap'
import { getActiveUserId, getActiveSessionEpoch } from './userSession'

// Cache mémoire des MÉTADONNÉES de comptes mail (jamais de mot de passe —
// il vit exclusivement dans l'Android Keystore, côté natif).
// Rôle : fournir une lecture SYNCHRONE pour l'exposition conditionnelle des
// outils mail au modèle (pattern imageTools/P1.3) et pour le system prompt.
// Rafraîchi au boot, à l'ajout/suppression d'un compte, et au switch de user.
let cachedAccounts: MailAccountMeta[] = []
let cacheOwner: string | null = null, cacheEpoch = -1, generation = 0
let inventory: 'unknown' | 'loading' | 'ready' | 'failed' = 'unknown'
const notify = () => { try { window.dispatchEvent(new Event('mail-accounts-updated')) } catch { /* no DOM */ } }

/** No bridge call and no address/credentials. Empty is known only after success. */
export function getMailInventoryStatus() {
  const current = cacheOwner === getActiveUserId() && cacheEpoch === getActiveSessionEpoch()
  return { status: current ? inventory : 'unknown' as const,
    count: current && inventory === 'ready' ? cachedAccounts.length : 0, generation }
}

export function getCachedMailAccounts(): MailAccountMeta[] {
  return cacheOwner === getActiveUserId() && cacheEpoch === getActiveSessionEpoch() ? [...cachedAccounts] : []
}

export function hasConnectedMailAccounts(): boolean {
  return getCachedMailAccounts().length > 0
}

/** BUG 6 : à appeler AVANT setActiveSession() lors d'un switch de compte. */
export function resetMailAccountsCache(): void {
  cachedAccounts = []
  cacheOwner = null; cacheEpoch = -1; generation++
  inventory = 'unknown'; notify()
}

export async function refreshMailAccounts(): Promise<MailAccountMeta[]> {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch(), attempt = ++generation
  const current = () => generation === attempt && owner === getActiveUserId() && epoch === getActiveSessionEpoch()
  cacheOwner = owner; cacheEpoch = epoch; inventory = 'loading'; notify()
  if (!isMailImapAvailable()) {
    cachedAccounts = []
    inventory = 'unknown'; notify()
    return []
  }
  try {
    const accounts = await listMailAccounts()
    if (!current()) return []
    cachedAccounts = accounts
    inventory = 'ready'
  } catch {
    // Plugin indisponible (vieille APK, plateforme non supportée) : cache vide,
    // la feature est simplement absente — jamais d'erreur bloquante au boot.
    if (!current()) return []
    cachedAccounts = []
    inventory = 'failed'
  }
  if (!current()) return []
  cacheOwner = owner; cacheEpoch = epoch
  try {
    // BUG 54 : toute écriture d'un store partagé entre vues dispatch un event.
    window.dispatchEvent(new CustomEvent('mail-accounts-updated'))
  } catch {
    // Contexte sans window (tests) — silencieux.
  }
  return cachedAccounts
}

/**
 * Suppression de compte (RGPD) : efface les comptes natifs du user PUIS le
 * cache mémoire. Appelée par `wipeLocalAccount()` — et par elle seule.
 *
 * Si la purge native échoue, l'erreur remonte et le cache mémoire n'est PAS
 * vidé : l'état affiché reste fidèle à ce qui subsiste réellement sur
 * l'appareil, et l'utilisateur peut relancer la suppression.
 */
export async function purgeMailAccountsForUser(userId: string | null): Promise<void> {
  if (userId) {
    await clearMailAccountsForUser(userId)
  }
  resetMailAccountsCache()
}
