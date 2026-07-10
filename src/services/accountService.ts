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
import {
  getActiveUserId,
  getActiveSession,
  removeKnownSession,
  clearActiveSession,
  purgeLegacyGlobalReports,
} from './userSession'
import { wipeFileStorage } from './secureFileStorage'
import { getTrialToken } from './emailTrialClient'

/**
 * Supprime les données personnelles côté serveur (mémoire + quotas).
 * Utilise le token Google ou, pour un essai par email, le jeton de session
 * x-arty-trial-token. No-op uniquement pour une session purement locale.
 */
export async function deleteServerAccount(): Promise<void> {
  const session = getActiveSession()
  if (!session) throw new Error('No active account to delete')

  // API-key/demo accounts are local-only and have no server account record.
  if (session.authMethod === 'apikey' || session.authMethod === 'demo') return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session.authMethod === 'google') {
    const googleToken = await getValidAccessToken()
    if (!googleToken) throw new Error('Google credential unavailable for account deletion')
    headers['x-google-token'] = googleToken
  } else {
    const trialToken = getTrialToken()
    if (!trialToken) throw new Error('Email credential unavailable for account deletion')
    headers['x-arty-trial-token'] = trialToken
  }

  const res = await fetch(apiUrl('/api/account/delete'), {
    method: 'POST',
    headers,
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

  // Delete IndexedDB first while the owner identity is still active. If this
  // fails, propagate the error and keep the session/localStorage intact so the
  // user can retry instead of being told that deletion succeeded incompletely.
  await wipeFileStorage(userId)

  // Pre-scoping report keys contain no owner metadata. Purge all of them so a
  // historical personal report cannot survive an erasure request.
  purgeLegacyGlobalReports()
  clearAllForActiveUser()
  // `arty-email-hash-{email}` (reconnaissance des comptes au login) n'est pas
  // préfixée par userId -> effacement ciblé de la seule clé du user courant.
  if (email) {
    try { localStorage.removeItem(`arty-email-hash-${email}`) } catch { /* noop */ }
  }
  if (userId) removeKnownSession(userId)
  clearActiveSession()
}

/** Suppression complète : serveur (perso) puis local. Le caller recharge ensuite. */
export async function deleteAccount(): Promise<void> {
  await deleteServerAccount()
  await wipeLocalAccount()
}
