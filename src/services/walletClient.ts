import { captureBillingContext, onBillingContextInvalidated, type BillingContext } from './billingContext'
import { apiUrl } from './apiBase'
import { getTrialRemaining } from './trialClient'

// Client pour le solde de crédits prépayés (GET /api/wallet/balance).
// Tout est en micro-USD côté serveur ; la conversion en "crédits" affichés est
// un choix de présentation (voir MICRO_PER_CREDIT dans WalletBadge).

export interface WalletBalance {
  /** Verified server classification; absent on older servers means unknown. */
  trialState?: 'unknown' | 'active' | 'exhausted' | 'outside-trial'
  hasWallet: boolean
  balanceMicro: number
  reservedMicro: number
  /** Solde dépensable, nul tant qu'un remboursement reste à rapprocher. */
  availableMicro: number
  reversalPending: boolean
}

// Cache synchrone du solde disponible : les services non-React (aiRouter) en ont
// besoin sans hook. Rafraîchi à chaque fetch (WalletBadge + usePlanStatus).
const WALLET_CACHE_KEY = 'arty-wallet-available'
// Cache du flag « cet user a un wallet » — sert à n'afficher qu'UNE unité de
// coût (crédits) pour les users prépayés : le CostIndicator (coût fournisseur
// en ~$, non markupé) est masqué pour eux, sinon il diverge du solde crédits et
// EXPOSE le markup (P1.7, audit 14 juin).
const WALLET_HAS_KEY = 'arty-wallet-has'
let trialRevision = 0
if (typeof window !== 'undefined') {
  window.addEventListener('arty-trial-remaining-changed', () => { trialRevision++ })
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.includes('trial-remaining')) trialRevision++
  })
}
let walletRequestSerial = 0
let observingContext = false
let sharedBalance: { context: BillingContext; promise: Promise<WalletBalance | null> } | null = null
let snapshot: { context: BillingContext; data: WalletBalance; trialRevision: number } | null = null
const listeners = new Set<() => void>()

export function onWalletBalanceChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notifyBalanceChanged() {
  for (const listener of [...listeners]) { try { listener() } catch { /* isolate subscribers */ } }
  try { window.dispatchEvent(new CustomEvent('arty-plan-status-changed')) } catch { /* no browser */ }
}

export function getWalletSnapshot(): WalletBalance | null {
  const current = snapshot
  return current?.context.isCurrent() && snapshot === current ? current.data : null
}

function parseWalletBalance(value: unknown): WalletBalance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.hasWallet !== 'boolean' || typeof data.reversalPending !== 'boolean') return null
  for (const key of ['balanceMicro', 'reservedMicro', 'availableMicro']) {
    if (typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || data[key] < 0) return null
  }
  const { balanceMicro, reservedMicro, availableMicro } = data as unknown as WalletBalance
  if (!data.hasWallet && (balanceMicro !== 0 || reservedMicro !== 0 || availableMicro !== 0 || data.reversalPending)) return null
  if (availableMicro > Math.max(0, balanceMicro - reservedMicro)) return null
  // Blocked status is authoritative even if a future server accidentally
  // includes an old positive available amount. Never cache that positive.
  return { trialState: ['active', 'exhausted', 'outside-trial'].includes(data.trialState as string)
      ? data.trialState as WalletBalance['trialState'] : 'unknown', hasWallet: data.hasWallet, balanceMicro, reservedMicro,
    availableMicro: data.reversalPending ? 0 : availableMicro, reversalPending: data.reversalPending }
}

// 1 crédit AFFICHÉ = 1 cent US (10 000 micro-USD). Choix de PRÉSENTATION
// centralisé ICI (avant : dupliqué dans WalletBadge) — une seule source pour
// toutes les surfaces qui convertissent µ$ ↔ crédits.
export const MICRO_PER_CREDIT = 10_000

/** Convertit un montant en micro-USD en crédits affichés (arrondi bas). */
export function microToCredits(micro: number): number {
  return Math.max(0, Math.floor((Number.isFinite(micro) ? micro : 0) / MICRO_PER_CREDIT))
}

/** Vrai si le dernier fetch a vu un wallet (lecture synchrone, sans hook). */
export function hasWalletCached(): boolean {
  return getWalletSnapshot()?.hasWallet ?? false
}

export function getCachedWalletAvailableMicro(): number {
  return getWalletSnapshot()?.availableMicro ?? 0
}

/** Invalide les requêtes en vol et purge les caches globaux du wallet. */
export function clearWalletCache(): void {
  walletRequestSerial += 1
  sharedBalance = null
  snapshot = null
  try {
    localStorage.removeItem(WALLET_CACHE_KEY)
    localStorage.removeItem(WALLET_HAS_KEY)
  } catch {
    /* Persisted hints are never authority; RAM is already closed. */
  }
  notifyBalanceChanged()
}

/** A terminal Arty AI refusal closes spendability without inventing a balance,
 * refetching, or changing the verified subscription. Retire older GETs first. */
export function markWalletReconciliationPending(context: BillingContext): void {
  if (!context.isCurrent()) return
  const previous = getWalletSnapshot()
  walletRequestSerial += 1
  sharedBalance = null
  snapshot = previous?.hasWallet ? { context, trialRevision, data: { ...previous, availableMicro: 0, reversalPending: true } } : null
  try {
    localStorage.removeItem(WALLET_CACHE_KEY)
    localStorage.removeItem(WALLET_HAS_KEY)
  } catch { /* RAM is already closed; persisted hints are not authority. */ }
  notifyBalanceChanged()
}

/**
 * L'utilisateur peut-il payer un modèle PREMIUM avec ses crédits MAINTENANT ?
 * = il a des crédits ET n'est PAS sur un essai gratuit encore actif.
 * Pendant l'essai (restant > 0), le serveur force Haiku (« essai gratuit
 * d'abord ») → on ne débloque pas le premium. Le wallet ne prend la main que
 * quand l'essai est épuisé (restant ≤ 0) ou que l'user n'a jamais eu d'essai
 * selon la classification vérifiée du serveur. Un cache absent ne prouve rien.
 */
export function creditsCoverPremium(): boolean {
  if (getCachedWalletAvailableMicro() <= 0) return false
  const state = getWalletSnapshot()?.trialState
  if (state !== 'outside-trial' && state !== 'exhausted') return false
  // A fresh server classification supersedes an older display cache (including
  // usage on the other channel). A newer quota event can still close this receipt.
  return snapshot?.trialRevision === trialRevision || getTrialRemaining() === 0
}

export async function fetchWalletBalance(): Promise<WalletBalance | null> {
  if (!observingContext) { observingContext = true; onBillingContextInvalidated(clearWalletCache) }
  const context = captureBillingContext()
  if (!context.isCurrent()) return null
  const previous = sharedBalance
  if (previous?.context.isCurrent() && sharedBalance === previous) return previous.promise
  const requestId = ++walletRequestSerial
  const task = { context, promise: Promise.resolve<WalletBalance | null>(null) }
  sharedBalance = task
  task.promise = resolveWalletBalance(context, requestId).finally(() => {
    if (sharedBalance === task) sharedBalance = null
  })
  return task.promise
}

async function resolveWalletBalance(context: BillingContext, requestId: number): Promise<WalletBalance | null> {
  const isCurrentRequest = () =>
    requestId === walletRequestSerial
    && context.isCurrent() && requestId === walletRequestSerial
  const requestTrialRevision = trialRevision
  const token = await context.getAccessToken()
  if (!isCurrentRequest()) return null
  if (!token) {
    if (isCurrentRequest()) clearWalletCache()
    return null
  }
  try {
    const resp = await fetch(apiUrl('/api/wallet/balance'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) {
      if (isCurrentRequest()) clearWalletCache()
      return null
    }
    const data = parseWalletBalance(await resp.json())
    // Un changement de compte ou un fetch plus récent a eu lieu pendant le
    // réseau : cette réponse ne doit jamais repeupler les caches globaux.
    if (!isCurrentRequest()) return null
    if (!data) { clearWalletCache(); return null }
    // Publish closed/current RAM before best-effort persistence. Quota or
    // disabled localStorage must not resurrect a previous positive balance.
    snapshot = { context, data, trialRevision: requestTrialRevision }
    try {
      localStorage.setItem(WALLET_CACHE_KEY, String(data.availableMicro ?? 0))
      if (!isCurrentRequest()) return null
      localStorage.setItem(WALLET_HAS_KEY, data.hasWallet ? '1' : '0')
    } catch {
      /* storage indispo — non bloquant */
    }
    if (!isCurrentRequest()) return null
    notifyBalanceChanged()
    // A subscriber may have invalidated this receipt synchronously. Do not
    // hand a revoked DTO to a checkout/plan continuation after publication.
    return isCurrentRequest() ? getWalletSnapshot() : null
  } catch {
    if (isCurrentRequest()) clearWalletCache()
    return null
  }
}
