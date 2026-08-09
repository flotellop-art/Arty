import {
  isMailImapAvailable,
  listMailAccounts,
  clearMailAccountsForUser,
  type MailAccountMeta,
} from './native/mailImap'

// Cache mémoire des MÉTADONNÉES de comptes mail (jamais de mot de passe —
// il vit exclusivement dans l'Android Keystore, côté natif).
// Rôle : fournir une lecture SYNCHRONE pour l'exposition conditionnelle des
// outils mail au modèle (pattern imageTools/P1.3) et pour le system prompt.
// Rafraîchi au boot, à l'ajout/suppression d'un compte, et au switch de user.
let cachedAccounts: MailAccountMeta[] = []

export function getCachedMailAccounts(): MailAccountMeta[] {
  return cachedAccounts
}

export function hasConnectedMailAccounts(): boolean {
  return cachedAccounts.length > 0
}

/** BUG 6 : à appeler AVANT setActiveSession() lors d'un switch de compte. */
export function resetMailAccountsCache(): void {
  cachedAccounts = []
}

export async function refreshMailAccounts(): Promise<MailAccountMeta[]> {
  if (!isMailImapAvailable()) {
    cachedAccounts = []
    return []
  }
  try {
    cachedAccounts = await listMailAccounts()
  } catch {
    // Plugin indisponible (vieille APK, plateforme non supportée) : cache vide,
    // la feature est simplement absente — jamais d'erreur bloquante au boot.
    cachedAccounts = []
  }
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
