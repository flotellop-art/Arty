/**
 * Suppression de compte (RGPD — droit à l'effacement).
 *
 * Ordre : serveur d'abord (a besoin du token Google encore présent), puis local.
 * Si la suppression serveur échoue, on NE wipe PAS le local -> l'utilisateur
 * peut réessayer sans se retrouver dans un état incohérent.
 *
 * Le caller recharge la page après succès (reset propre vers l'écran de login).
 */

import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import { clearAllForActiveUser } from './scopedStorage'
import { getActiveUserId, getActiveSession, removeKnownSession, clearActiveSession } from './userSession'
import { wipeFileStorage } from './secureFileStorage'

/**
 * Supprime les données personnelles côté serveur (mémoire + quotas).
 * No-op si l'utilisateur n'a pas de compte Google (aucune donnée serveur).
 */
export async function deleteServerAccount(): Promise<void> {
  const googleToken = await getValidAccessToken()
  if (!googleToken) return
  const res = await fetch(apiUrl('/api/account/delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': googleToken },
  })
  if (!res.ok) throw new Error(`account delete failed (${res.status})`)
}

/**
 * Efface toutes les données locales du user actif : conversations, mémoire
 * locale, clés BYOK, tokens Google, profil, streaks… + pièces jointes (IndexedDB)
 * + retrait de la liste des comptes connus.
 */
export async function wipeLocalAccount(): Promise<void> {
  const userId = getActiveUserId()
  const email = getActiveSession()?.email
  clearAllForActiveUser()
  // `arty-email-hash-{email}` (reconnaissance des comptes au login) n'est pas
  // préfixée par userId -> effacement ciblé de la seule clé du user courant.
  if (email) {
    try { localStorage.removeItem(`arty-email-hash-${email}`) } catch { /* noop */ }
  }
  if (userId) removeKnownSession(userId)
  try {
    await wipeFileStorage()
  } catch {
    /* IndexedDB indisponible — non bloquant */
  }
  clearActiveSession()
}

/** Suppression complète : serveur (perso) puis local. Le caller recharge ensuite. */
export async function deleteAccount(): Promise<void> {
  await deleteServerAccount()
  await wipeLocalAccount()
}
