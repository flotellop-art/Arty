/**
 * UpgradeScreen — pricing page reachable from Settings, from a 403
 * `no_active_subscription`, or from a 429 `premium_cap_reached`. Shows three
 * tiers (Free/BYOK, Pro one-time, Subscription) plus an optional Pack +100
 * messages card for active subscribers.
 *
 * A checkout callback is not proof of payment (on Web it fires on opening).
 * Recheck through the shared status contract, bound to the original account.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  openCheckout,
  openCreemCheckout,
  canPurchase,
  SUBSCRIPTION_PORTAL_URL,
  type CheckoutPlan,
} from '../services/checkout'
import { getStoredUser } from '../services/googleAuth'
import { fetchWalletBalance, creditsCoverPremium } from '../services/walletClient'
import { captureBillingContext, onBillingContextInvalidated } from '../services/billingContext'
import { getActiveSessionEpoch, getActiveUserId } from '../services/userSession'
import { getTrialRemaining } from '../services/trialClient'
import { usePlanStatus } from '../hooks/usePlanStatus'

export type CurrentPlan = 'byok' | 'pro' | 'subscription' | 'unknown'

interface UpgradeScreenProps {
  onBack: () => void
  currentPlan: CurrentPlan
  /** Email used to pre-fill checkout. Falls back to the stored Google user. */
  email?: string
}

type StatusResult =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'active'; plan: string }
  | { kind: 'pending' }
  | { kind: 'creditsAdded' }
  | { kind: 'error'; message: string }

export function UpgradeScreen({ onBack, currentPlan: currentPlanProp, email }: UpgradeScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const scrollToPremiumPack = params.get('scroll') === 'premium'
  const premiumPackRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<StatusResult>({ kind: 'idle' })
  const [creditsBusy, setCreditsBusy] = useState(false)
  const [trialRemaining, setTrial] = useState(getTrialRemaining)
  const alive = useRef(true), actionSerial = useRef(0), busyRef = useRef<object | null>(null)
  const renderOwner = getActiveUserId(), renderEpoch = getActiveSessionEpoch()

  // Bug P0.7 (audit) : App.tsx ne sait dériver que 'byok' | 'unknown' depuis
  // authMethod — un abonné connecté en Google arrivait toujours en 'unknown',
  // le PremiumPackCard n'était jamais rendu et le `?scroll=premium` tombait
  // dans le vide. On résout le plan réel via /api/subscription/status.
  const planStatus = usePlanStatus()
  const verified = !planStatus.loading && !planStatus.authRejected && !planStatus.authRequired && !planStatus.statusUnavailable
  // Local BYOK configuration is not proof of a paid entitlement. VIP is not
  // a licence or subscription; App/Templates access gates remain unchanged.
  const byokConfigured = currentPlanProp === 'byok'
  const currentPlan: CurrentPlan | 'vip' = verified && planStatus.plan !== 'free'
    ? planStatus.plan : byokConfigured ? 'byok' : 'unknown'

  const resolvedEmail = email ?? getStoredUser()?.email ?? ''

  useEffect(() => {
    alive.current = true
    const syncTrial = () => setTrial(getTrialRemaining())
    const off = onBillingContextInvalidated(() => {
      actionSerial.current += 1; busyRef.current = null
      setCreditsBusy(false); setStatus({ kind: 'idle' })
    })
    window.addEventListener('arty-trial-remaining-changed', syncTrial)
    return () => { alive.current = false; actionSerial.current += 1; off(); window.removeEventListener('arty-trial-remaining-changed', syncTrial) }
  }, [])

  const captureAction = () => {
    const id = ++actionSerial.current, context = captureBillingContext()
    return () => {
      try {
        return alive.current && id === actionSerial.current && context.isCurrent()
          && renderOwner === getActiveUserId() && renderEpoch === getActiveSessionEpoch()
          && context.isCurrent() && id === actionSerial.current
      } catch { return false }
    }
  }

  useEffect(() => {
    if (!scrollToPremiumPack) return
    // The premium pack card is only rendered for subscribers — `currentPlan`
    // est dans les deps pour re-tenter le scroll quand le plan résolu en
    // async (usePlanStatus) fait apparaître la carte après le mount.
    const t = window.setTimeout(() => {
      premiumPackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(t)
  }, [scrollToPremiumPack, currentPlan])

  const refreshStatus = async (isCurrent: () => boolean) => {
    if (!isCurrent()) return
    setStatus({ kind: 'checking' })
    try {
      const next = await planStatus.refresh()
      if (!isCurrent()) return
      // A focus/pageshow refresh can supersede this subscriber, even while
      // the shared request succeeds. Null is not proof of missing identity.
      if (!next) { setStatus({ kind: 'idle' }); return }
      if (next.authRequired || next.authRejected) {
        setStatus({ kind: 'error', message: t('upgrade.errorNoToken') })
        return
      }
      if (next.statusUnavailable || next.loading) {
        setStatus({ kind: 'pending' })
        return
      }
      setStatus(next.plan !== 'free' ? { kind: 'active', plan: next.plan } : { kind: 'pending' })
    } catch {
      if (isCurrent()) setStatus({ kind: 'pending' })
    }
  }

  const launchCheckout = async (plan: CheckoutPlan) => {
    const isCurrent = captureAction()
    if (!isCurrent()) return
    if (!resolvedEmail) {
      setStatus({
        kind: 'error',
        message: t('upgrade.errorNoEmail'),
      })
      return
    }
    try { await openCheckout(plan, resolvedEmail, { onReturn: () => { void refreshStatus(isCurrent) } }) }
    catch { if (isCurrent()) setStatus({ kind: 'error', message: t('upgrade.creditsError') }) }
  }

  // Le crédit arrive via le webhook Creem (asynchrone) — il peut atterrir APRÈS
  // la fermeture du navigateur de paiement. On poll le solde en backoff jusqu'à
  // le voir augmenter, puis on notifie le badge (event 'wallet-updated').
  const pollWalletAfterPurchase = async (beforeMicro: number, isCurrent: () => boolean) => {
    if (!isCurrent()) return
    setStatus({ kind: 'checking' })
    const delays = [1500, 3000, 5000]
    for (const d of delays) {
      await new Promise((r) => setTimeout(r, d))
      if (!isCurrent()) return
      const bal = await fetchWalletBalance()
      if (!isCurrent()) return
      if (bal && bal.availableMicro > beforeMicro) {
        setStatus({ kind: 'creditsAdded' })
        window.dispatchEvent(new Event('wallet-updated'))
        return
      }
    }
    // Pas encore visible : le badge se mettra à jour via son interval. On notifie
    // quand même pour forcer un dernier refresh.
    setStatus({ kind: 'pending' })
    window.dispatchEvent(new Event('wallet-updated'))
  }

  const launchCreditsCheckout = async () => {
    if (busyRef.current) return
    const isCurrent = captureAction()
    if (!isCurrent()) return
    const ticket = {}; busyRef.current = ticket
    setCreditsBusy(true)
    try {
      const before = await fetchWalletBalance()
      if (!isCurrent()) return
      // Unknown is not zero: do not invent a balance increase afterward.
      if (!before) { setStatus({ kind: 'error', message: t('upgrade.creditsError') }); return }
      const beforeMicro = before.availableMicro
      const ok = await openCreemCheckout('credits_10', {
        isCurrent,
        onReturn: () => {
          void pollWalletAfterPurchase(beforeMicro, isCurrent)
        },
      })
      if (isCurrent() && !ok) setStatus({ kind: 'error', message: t('upgrade.creditsError') })
    } finally {
      // Superseding a result does not transfer ownership of its busy lock.
      if (busyRef.current === ticket) {
        busyRef.current = null
        if (alive.current && captureBillingContext().isCurrent()) setCreditsBusy(false)
      }
    }
  }

  const handleByokClick = () => {
    if (currentPlan === 'byok') return
    // Route the user to the API keys flow — the existing settings entry point
    // handles BYOK key entry. No checkout to launch here.
    navigate('/')
    window.dispatchEvent(new CustomEvent('arty-open-api-keys'))
  }

  return (
    <div
      className="bg-theme-bg text-theme-ink overflow-y-auto"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      <header
        className="sticky top-0 z-10 bg-theme-bg flex items-center gap-3 px-5 py-4 border-b border-theme-border"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={t('upgrade.back')}
          className="p-2 -ml-2 rounded hover:bg-theme-ink/5 text-theme-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M12 4L6 10L12 16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
          {t('upgrade.headerTitle')}
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-5 pt-8 pb-12 space-y-6">
        <div>
          <h1 className="font-display font-medium text-[32px] sm:text-[38px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            {t('upgrade.heroMain')} <span className="italic text-theme-accent">{t('upgrade.heroAccent')}</span>
          </h1>
          <p className="font-display italic text-theme-muted text-base mt-2">
            {t('upgrade.heroSubtitle')}
          </p>
        </div>

        <section aria-live="polite" className="rounded-xl border border-theme-border px-4 py-3 space-y-2 text-sm">
          {planStatus.loading ? <p>{t('upgrade.statusChecking')}</p>
            : planStatus.authRejected || planStatus.authRequired ? <>
              <p>{t(planStatus.authRejected ? 'chat.planBadge.authRejectedTitle' : 'chat.planBadge.authRequiredTitle')}</p>
              <button type="button" className="min-h-11 underline" onClick={() => window.dispatchEvent(new CustomEvent('arty-reconnect-google'))}>{t('chat.planBadge.authRequired')}</button>
            </> : planStatus.statusUnavailable ? <p>{t('chat.planBadge.statusUnavailableTitle')}</p>
            : currentPlan === 'vip' || currentPlan === 'pro' || currentPlan === 'subscription'
              ? <p data-testid="verified-offer-access">{t(`upgrade.access${currentPlan === 'vip' ? 'Vip' : currentPlan === 'pro' ? 'Pro' : 'Subscription'}`)}</p>
              : <p>{t('upgrade.accessOptions')}</p>}
          {!planStatus.loading && <button type="button" className="min-h-11 underline" onClick={() => { void refreshStatus(captureAction()) }}>{t('upgrade.recheck')}</button>}
        </section>
        {status.kind !== 'idle' && <StatusBanner status={status} />}

        {verified && planStatus.plan === 'free' && !byokConfigured && !creditsCoverPremium() && trialRemaining !== null && (
          <p data-testid="offer-trial-status" className="px-3 py-2.5 rounded-xl bg-theme-accent/10 text-theme-ink text-sm font-display text-center">
            {t(trialRemaining > 0 ? 'upgrade.trialRemaining' : 'upgrade.trialEnded', { count: trialRemaining })}
          </p>
        )}

        {/* Play Store — sur natif, AUCUN parcours d'achat ne doit être visible
            (biens numériques hors Google Play Billing = motif de rejet). On ne
            garde que BYOK (gratuit côté Arty) + un bloc informatif neutre. Le
            statut d'un abonné existant reste visible ailleurs (PlanBadge,
            quotas). */}
        <div className="grid grid-cols-1 gap-4">
          <FreeBYOKCard isCurrent={byokConfigured} onClick={handleByokClick} />
          {canPurchase && (
            <>
              <ProCard
                isCurrent={currentPlan === 'pro'}
                onBuy={() => launchCheckout('pro')}
              />
              <SubscriptionCard
                isCurrent={currentPlan === 'subscription'}
                onSubscribe={() => launchCheckout('subscription')}
              />
              <CreditsCard busy={creditsBusy} onBuy={launchCreditsCheckout} />
            </>
          )}
        </div>

        {!canPurchase && (
          <div className="rounded-sm border border-theme-border bg-theme-surface px-5 py-4">
            <p className="font-display text-sm text-theme-ink">
              {t('upgrade.nativeUnavailableTitle')}
            </p>
            <p className="font-sans text-sm text-theme-muted mt-1 leading-relaxed">
              {t('upgrade.nativeUnavailableBody')}
            </p>
          </div>
        )}

        {canPurchase && currentPlan === 'subscription' && (
          <div ref={premiumPackRef} className="pt-4">
            <PremiumPackCard onBuy={() => launchCheckout('premium_pack')} />
          </div>
        )}

        {/* L'accès à l'annulation reste disponible aux abonnés existants, y
            compris sur Android : la politique Google Play sur les abonnements
            exige une méthode d'annulation en ligne facile d'accès. Le portail
            est celui du store Arty, jamais l'espace marchand Lemon Squeezy.
            Les upgrades/downgrades doivent rester désactivés dans sa config
            tant qu'Arty n'est pas inscrit au programme de liens externes. */}
        {currentPlan === 'subscription' && (
          <a
            href={SUBSCRIPTION_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block font-display italic text-[12px] text-theme-muted hover:text-theme-ink underline underline-offset-2 text-center pt-2 transition-colors"
          >
            {t('upgrade.manageSubscription')}
          </a>
        )}

        {/* P2.4 — « pourquoi c'est moins cher » : on assume le modèle éco
            (routage intelligent + marge faible) pour désarmer le « trop beau
            pour être vrai ». La transparence économique devient la marque. */}
        {canPurchase && <WhyCheaperSection />}

        {/* P0.10 — la transparence comme argument de vente (audit concurrentiel :
            la plainte la plus virale du segment = limites opaques). */}
        {canPurchase && (
          <p className="font-display italic text-[11px] text-theme-muted text-center pt-4 leading-relaxed">
            {t('upgrade.transparency')}
          </p>
        )}
        <p className="font-display italic text-[11px] text-theme-muted text-center pt-1">
          {t('upgrade.legal')} ·{' '}
          <a className="underline underline-offset-2 hover:text-theme-ink" href="/terms/">
            {t('upgrade.legalTerms')}
          </a>{' '}·{' '}
          <a className="underline underline-offset-2 hover:text-theme-ink" href="/privacy/">
            {t('upgrade.legalPrivacy')}
          </a>{' '}·{' '}
          <a className="underline underline-offset-2 hover:text-theme-ink" href="/legal-notice/">
            {t('upgrade.legalNotice')}
          </a>{' '}·{' '}
          <a className="underline underline-offset-2 hover:text-theme-ink" href="mailto:support@tryarty.com">
            {t('upgrade.support')}
          </a>
        </p>
      </div>
    </div>
  )
}

// ─── Status banner ──────────────────────────────────────────────────────────

function StatusBanner({ status }: { status: StatusResult }) {
  const { t } = useTranslation()
  if (status.kind === 'idle') return null

  if (status.kind === 'checking') {
    return (
      <div className="rounded-sm border border-theme-border bg-theme-surface px-4 py-3 flex items-center gap-3">
        <Spinner />
        <span className="font-display italic text-sm text-theme-muted">
          {t('upgrade.statusChecking')}
        </span>
      </div>
    )
  }

  if (status.kind === 'active') {
    return (
      <div className="rounded-sm border border-theme-accent/60 bg-theme-surface px-4 py-3">
        <p className="font-display text-sm text-theme-ink">
          {t('upgrade.statusActive')}
          <span className="font-display italic text-theme-muted ml-2">({status.plan})</span>
        </p>
      </div>
    )
  }

  if (status.kind === 'pending') {
    return (
      <div className="rounded-sm border border-theme-border bg-theme-surface px-4 py-3">
        <p className="font-display text-sm text-theme-ink">{t('upgrade.statusPendingTitle')}</p>
        <p className="font-display italic text-xs text-theme-muted mt-0.5">
          {t('upgrade.statusPendingBody')}
        </p>
      </div>
    )
  }

  if (status.kind === 'creditsAdded') {
    return (
      <div className="rounded-sm border border-theme-accent/60 bg-theme-surface px-4 py-3">
        <p className="font-display text-sm text-theme-ink">{t('upgrade.creditsAdded')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-sm border border-theme-accent/60 bg-theme-surface px-4 py-3">
      <p className="font-display text-sm text-theme-accent">{status.message}</p>
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border-2 border-theme-muted/40 border-t-theme-accent animate-spin"
      aria-hidden
    />
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────────

interface CardShellProps {
  highlight?: boolean
  badge?: string
  children: React.ReactNode
}

function CardShell({ highlight, badge, children }: CardShellProps) {
  return (
    <article
      className={`relative flex flex-col rounded-sm bg-theme-surface p-6 sm:p-7 border ${
        highlight
          ? 'border-theme-accent/60 shadow-[0_2px_24px_rgba(0,0,0,0.06)]'
          : 'border-theme-border'
      }`}
    >
      {badge && (
        <span className="absolute -top-3 right-5 px-2.5 py-1 rounded-pill bg-theme-accent text-theme-bg font-sans text-[10px] font-semibold uppercase tracking-kicker">
          {badge}
        </span>
      )}
      {children}
    </article>
  )
}

interface FreeBYOKCardProps {
  isCurrent: boolean
  onClick: () => void
}

function FreeBYOKCard({ isCurrent, onClick }: FreeBYOKCardProps) {
  const { t } = useTranslation()
  return (
    <CardShell>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Free / BYOK
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">{t('upgrade.byokPrice')}</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        {t('upgrade.byokDescription')}
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? t('upgrade.currentPlan') : t('upgrade.byokCta')}
      </button>
    </CardShell>
  )
}

interface ProCardProps {
  isCurrent: boolean
  onBuy: () => void
}

function ProCard({ isCurrent, onBuy }: ProCardProps) {
  const { t } = useTranslation()
  return (
    <CardShell highlight badge={t('upgrade.proBadge')}>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Arty Pro
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">{t('upgrade.proPrice')}</p>
      <p className="font-display italic text-xs text-theme-muted mt-1">{t('upgrade.proTagline')}</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        {t('upgrade.proDescription')}
      </p>
      <button
        type="button"
        onClick={onBuy}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? t('upgrade.currentPlan') : t('upgrade.proCta')}
      </button>
    </CardShell>
  )
}

interface SubscriptionCardProps {
  isCurrent: boolean
  onSubscribe: () => void
}

function SubscriptionCard({ isCurrent, onSubscribe }: SubscriptionCardProps) {
  const { t } = useTranslation()
  return (
    <CardShell>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Arty Subscription
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">{t('upgrade.subscriptionPrice')}</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        {t('upgrade.subscriptionDescription')}
      </p>
      {/* P2.3 — rassurance AVANT de s'abonner : l'annulation facile lève le
          frein n°1 à l'abonnement. Affichée même aux non-abonnés (le lien
          « gérer » plus bas ne s'affiche qu'aux abonnés actifs). */}
      <p className="mt-2 font-display italic text-[12px] text-theme-accent leading-relaxed">
        {t('upgrade.subscriptionReassurance')}
      </p>
      <button
        type="button"
        onClick={onSubscribe}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? t('upgrade.currentPlan') : t('upgrade.subscriptionCta')}
      </button>
    </CardShell>
  )
}

interface CreditsCardProps {
  busy: boolean
  onBuy: () => void
}

function CreditsCard({ busy, onBuy }: CreditsCardProps) {
  const { t } = useTranslation()
  return (
    <CardShell>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        {t('upgrade.creditsTitle')}
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">{t('upgrade.creditsPrice')}</p>
      <p className="font-display italic text-xs text-theme-muted mt-1">
        {t('upgrade.creditsTagline')}
      </p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        {t('upgrade.creditsDescription')}
      </p>
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? t('upgrade.creditsBusy') : t('upgrade.creditsCta')}
      </button>
    </CardShell>
  )
}

// P2.4 — section dépliable « Pourquoi c'est moins cher ? ». Placée sur la page
// pricing, là où naît le doute « trop beau pour être vrai ». Contenu volontairement
// concret : routage intelligent, marge faible assumée, limites lisibles, BYOK.
function WhyCheaperSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const items = ['whyRouting', 'whyMargin', 'whyTransparency', 'whyByok'] as const
  return (
    <div className="rounded-sm border border-theme-border bg-theme-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-theme-ink/[0.02] transition-colors"
      >
        <span className="font-display text-[15px] font-medium text-theme-ink">
          {t('upgrade.whyTitle')}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-2.5">
          <p className="font-display italic text-sm text-theme-muted">{t('upgrade.whyIntro')}</p>
          <ul className="space-y-2">
            {items.map((k) => (
              <li key={k} className="font-sans text-sm text-theme-ink/80 flex gap-2 leading-relaxed">
                <span className="text-theme-accent shrink-0">•</span>
                <span>{t(`upgrade.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface PremiumPackCardProps {
  onBuy: () => void
}

function PremiumPackCard({ onBuy }: PremiumPackCardProps) {
  const { t } = useTranslation()
  return (
    <CardShell>
      <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
        {t('upgrade.premiumPackEyebrow')}
      </span>
      <h2 className="mt-2 font-display text-[20px] leading-tight font-medium text-theme-ink">
        {t('upgrade.premiumPackTitle')}
      </h2>
      <p className="mt-2 font-display text-xl text-theme-ink">{t('upgrade.premiumPackPrice')}</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        {t('upgrade.premiumPackDescription')}
      </p>
      <button
        type="button"
        onClick={onBuy}
        className="mt-6 w-full py-3 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90"
      >
        {t('upgrade.premiumPackCta')}
      </button>
    </CardShell>
  )
}
