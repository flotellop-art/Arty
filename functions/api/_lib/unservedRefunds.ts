import type { Env } from '../../env'
import { voidTrialMessage } from './checkAllowedUser'
import { voidPremiumCap, type PremiumCapResult } from './checkPremiumCap'
import { voidEmailTrialMessage } from './emailTrial'
import { voidDailyQuota, type QuotaDebit } from './quota'
import { voidWalletBilling } from './walletBilling'

/**
 * Une erreur upstream justifie-t-elle de rendre les COMPTEURS (essai, quota,
 * cap) ? La réserve wallet, elle, est toujours rendue : rien n'a été facturé.
 *
 * Remboursés : 5xx/529 (surcharge, panne), 429 (rate limit), 401/403 (clé du
 * propriétaire), 408/409, et tout motif de facturation de la clé serveur
 * (souvent encodé en 400, BUG 64). C'est exactement ce que les clients
 * retentent : le bug « 4 unités brûlées pour 1 surcharge » est fermé.
 *
 * NON remboursés : les autres 4xx (400 requête invalide, 404, 413, 422).
 * Une requête refusée pour son contenu garde son coût d'une unité, comme
 * avant, sinon un compte authentifié pourrait marteler la clé serveur sans
 * limite avec des payloads invalides (rate limit de l'organisation partagé
 * par tous les utilisateurs). Les clients ne retentent pas ces statuts.
 */
export function isRefundableUpstreamFailure(status: number, billing: boolean): boolean {
  if (billing) return true
  if (status >= 500) return true
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429
}

/**
 * Invariant « unité consommée ⟺ réponse servie » (issue #393, audit du
 * 24 juillet 2026, H3/M8).
 *
 * Les proxys IA consomment l'essai, le quota journalier et le cap premium
 * AVANT l'appel upstream. Les clients retentent sur 429/529/5xx (jusqu'à 4
 * fois pour Anthropic) : sans remboursement, une surcharge sur un seul
 * message brûlait 4 unités. Ce traqueur garde la trace de ce qui a été
 * réellement débité et le rend si la réponse n'est pas servie.
 *
 * Idempotence : chaque marqueur est effacé dès que son remboursement est
 * planifié, et `markServed()` les efface tous. Un même débit ne peut donc
 * être rendu qu'une fois par requête, quel que soit le nombre de chemins
 * d'échec traversés. Il n'y a pas d'idempotence inter-requêtes à garantir :
 * chaque requête ne rend que ce qu'elle a elle-même consommé. Les fonctions
 * `void*` sont best-effort et bornées à zéro.
 *
 * Seuls les débits CONFIRMÉS sont suivis : un résultat fail-open sans
 * marqueur `debited` (quota, cap) ou sans `trialDebited` (essai) n'est
 * jamais remboursé.
 */
export interface UnservedRefunds {
  /** Essai consommé pour cette identité (`trialDebited === true`). */
  trackTrial(kind: 'google' | 'email-trial'): void
  /** Quota journalier confirmé débité. */
  trackDailyQuota(model: string, debited: QuotaDebit | undefined): void
  /** Cap premium confirmé débité (ignoré si `debited` absent). */
  trackPremiumCap(cap: PremiumCapResult): void
  /** Réserve wallet ouverte. */
  trackWallet(resId: string | undefined): void
  /**
   * Rend tout ce qui a été consommé et pas encore rendu. Retourne `true` si
   * une unité d'essai a été rendue : l'appelant doit alors corriger le
   * `x-trial-remaining` de la réponse d'erreur (sinon le client affiche un
   * compteur plus bas que D1 jusqu'au prochain succès).
   */
  refundAll(): boolean
  /**
   * Requête non servie. `counters: false` rend uniquement la réserve wallet
   * et garde essai/quota/cap débités (voir `isRefundableUpstreamFailure`).
   * Même valeur de retour que `refundAll`.
   */
  refundUnserved(options: { counters: boolean }): boolean
  /** La réponse est servie : plus rien ne doit être rendu. */
  markServed(): void
}

export function createUnservedRefunds(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  /** Clé de compteur (email Google ou clé email-trial préfixée). */
  counterEmail: string,
  /** Email brut de l'identité, utilisé par les compteurs d'essai. */
  identityEmail: string,
): UnservedRefunds {
  let trial: 'google' | 'email-trial' | undefined
  let daily: { model: string; debited: QuotaDebit } | undefined
  let cap: PremiumCapResult | undefined
  let walletResId: string | undefined

  const refundWallet = () => {
    if (walletResId) {
      waitUntil(voidWalletBilling(env, walletResId, counterEmail))
      walletResId = undefined
    }
  }
  const refundCounters = (): boolean => {
    if (cap) {
      waitUntil(voidPremiumCap(env, counterEmail, cap))
      cap = undefined
    }
    if (daily) {
      waitUntil(voidDailyQuota(env, counterEmail, daily.model, daily.debited))
      daily = undefined
    }
    const trialRefunded = trial !== undefined
    if (trial === 'google') waitUntil(voidTrialMessage(env, identityEmail))
    if (trial === 'email-trial') waitUntil(voidEmailTrialMessage(env, identityEmail))
    trial = undefined
    return trialRefunded
  }
  const keepCounters = () => {
    trial = undefined
    daily = undefined
    cap = undefined
  }

  return {
    trackTrial(kind) { trial = kind },
    trackDailyQuota(model, debited) {
      if (debited && (debited.global || debited.model)) daily = { model, debited }
    },
    trackPremiumCap(result) {
      if (result.allowed && result.debited) cap = result
    },
    trackWallet(resId) { if (resId) walletResId = resId },
    refundAll() {
      refundWallet()
      return refundCounters()
    },
    refundUnserved({ counters }) {
      refundWallet()
      if (counters) return refundCounters()
      keepCounters()
      return false
    },
    markServed() {
      keepCounters()
      walletResId = undefined
    },
  }
}
