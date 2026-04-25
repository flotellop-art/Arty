/**
 * UpgradeScreen — pricing page reachable from Settings, from a 403
 * `no_active_subscription`, or from a 429 `premium_cap_reached`. Shows three
 * tiers (Free/BYOK, Pro one-time, Subscription) plus an optional Pack +100
 * messages card for active subscribers.
 *
 * After the Lemon Squeezy checkout closes (`browserFinished`), we wait two
 * seconds for the webhook to land, then call `GET /api/subscription/status`
 * with the user's Google access token to surface the new state.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { openCheckout, type CheckoutPlan } from '../services/checkout'
import { getValidAccessToken, getStoredUser } from '../services/googleAuth'
import { apiUrl } from '../services/apiBase'

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
  | { kind: 'error'; message: string }

interface SubscriptionStatusResponse {
  active?: boolean
  plan?: string
}

export function UpgradeScreen({ onBack, currentPlan, email }: UpgradeScreenProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const scrollToPremiumPack = params.get('scroll') === 'premium'
  const premiumPackRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<StatusResult>({ kind: 'idle' })

  const resolvedEmail = email ?? getStoredUser()?.email ?? ''

  useEffect(() => {
    if (!scrollToPremiumPack) return
    // The premium pack card is only rendered for subscribers, but we still
    // attempt the scroll — the ref is null otherwise and the call is a no-op.
    const t = window.setTimeout(() => {
      premiumPackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(t)
  }, [scrollToPremiumPack])

  const refreshStatus = async () => {
    setStatus({ kind: 'checking' })
    // Give the Lemon Squeezy webhook a moment to reach the backend before we
    // poll. Two seconds matches what the spec asks for and is enough in
    // practice for the test-mode webhook.
    await new Promise((r) => setTimeout(r, 2000))

    try {
      const token = await getValidAccessToken()
      if (!token) {
        setStatus({ kind: 'error', message: 'Connecte-toi avec Google pour vérifier ton abonnement.' })
        return
      }
      const res = await fetch(apiUrl('/api/subscription/status'), {
        method: 'GET',
        headers: { 'x-google-token': token },
      })
      if (!res.ok) {
        setStatus({ kind: 'pending' })
        return
      }
      const data = (await res.json()) as SubscriptionStatusResponse
      if (data.active) {
        setStatus({ kind: 'active', plan: data.plan ?? 'subscription' })
      } else {
        setStatus({ kind: 'pending' })
      }
    } catch {
      setStatus({ kind: 'pending' })
    }
  }

  const launchCheckout = async (plan: CheckoutPlan) => {
    if (!resolvedEmail) {
      setStatus({
        kind: 'error',
        message: "Aucun email trouvé. Connecte-toi avec Google d'abord.",
      })
      return
    }
    await openCheckout(plan, resolvedEmail, { onReturn: refreshStatus })
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
          aria-label="Retour"
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
          Mise à niveau
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-5 pt-8 pb-12 space-y-6">
        <div>
          <h1 className="font-display font-medium text-[32px] sm:text-[38px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            Choisis ta <span className="italic text-theme-accent">formule.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-base mt-2">
            Pas d'engagement. Tu peux changer plus tard.
          </p>
        </div>

        {status.kind !== 'idle' && <StatusBanner status={status} />}

        <div className="grid grid-cols-1 gap-4">
          <FreeBYOKCard isCurrent={currentPlan === 'byok'} onClick={handleByokClick} />
          <ProCard
            isCurrent={currentPlan === 'pro'}
            onBuy={() => launchCheckout('pro')}
          />
          <SubscriptionCard
            isCurrent={currentPlan === 'subscription'}
            onSubscribe={() => launchCheckout('subscription')}
          />
        </div>

        {currentPlan === 'subscription' && (
          <div ref={premiumPackRef} className="pt-4">
            <PremiumPackCard onBuy={() => launchCheckout('premium_pack')} />
          </div>
        )}

        <p className="font-display italic text-[11px] text-theme-muted text-center pt-4">
          Paiement sécurisé via Lemon Squeezy. TVA incluse.
        </p>
      </div>
    </div>
  )
}

// ─── Status banner ──────────────────────────────────────────────────────────

function StatusBanner({ status }: { status: StatusResult }) {
  if (status.kind === 'idle') return null

  if (status.kind === 'checking') {
    return (
      <div className="rounded-sm border border-theme-border bg-theme-surface px-4 py-3 flex items-center gap-3">
        <Spinner />
        <span className="font-display italic text-sm text-theme-muted">
          Vérification de ton abonnement…
        </span>
      </div>
    )
  }

  if (status.kind === 'active') {
    return (
      <div className="rounded-sm border border-theme-accent/60 bg-theme-surface px-4 py-3">
        <p className="font-display text-sm text-theme-ink">
          ✓ Abonnement activé&nbsp;!
          <span className="font-display italic text-theme-muted ml-2">({status.plan})</span>
        </p>
      </div>
    )
  }

  if (status.kind === 'pending') {
    return (
      <div className="rounded-sm border border-theme-border bg-theme-surface px-4 py-3">
        <p className="font-display text-sm text-theme-ink">En attente</p>
        <p className="font-display italic text-xs text-theme-muted mt-0.5">
          La confirmation peut prendre une minute. Reviens dans quelques instants.
        </p>
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
  return (
    <CardShell>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Free / BYOK
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">Gratuit</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        Ta propre clé API · Tous les modèles · Stockage local
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? 'Mode actuel' : 'Passer en BYOK'}
      </button>
    </CardShell>
  )
}

interface ProCardProps {
  isCurrent: boolean
  onBuy: () => void
}

function ProCard({ isCurrent, onBuy }: ProCardProps) {
  return (
    <CardShell highlight badge="Populaire">
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Arty Pro
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">39€ une fois</p>
      <p className="font-display italic text-xs text-theme-muted mt-1">À vie, 3 appareils</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        Tout le Free · Templates métier · Support prioritaire · Pas d'abonnement
      </p>
      <button
        type="button"
        onClick={onBuy}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? 'Mode actuel' : 'Acheter Arty Pro'}
      </button>
    </CardShell>
  )
}

interface SubscriptionCardProps {
  isCurrent: boolean
  onSubscribe: () => void
}

function SubscriptionCard({ isCurrent, onSubscribe }: SubscriptionCardProps) {
  return (
    <CardShell>
      <h2 className="font-display text-[22px] leading-tight font-medium text-theme-ink">
        Arty Subscription
      </h2>
      <p className="mt-2 font-display text-2xl text-theme-ink">9,99€/mois</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        Sans clé API · 500 messages/mois · Claude, GPT-5-mini, Gemini, Mistral
      </p>
      <button
        type="button"
        onClick={onSubscribe}
        disabled={isCurrent}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isCurrent ? 'Mode actuel' : "S'abonner"}
      </button>
    </CardShell>
  )
}

interface PremiumPackCardProps {
  onBuy: () => void
}

function PremiumPackCard({ onBuy }: PremiumPackCardProps) {
  return (
    <CardShell>
      <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
        Quota dépassé ?
      </span>
      <h2 className="mt-2 font-display text-[20px] leading-tight font-medium text-theme-ink">
        Pack +100 messages premium
      </h2>
      <p className="mt-2 font-display text-xl text-theme-ink">1,99€</p>
      <p className="mt-3 font-sans text-sm text-theme-muted leading-relaxed">
        Pour les utilisateurs Subscription qui ont atteint leur quota mensuel.
      </p>
      <button
        type="button"
        onClick={onBuy}
        className="mt-6 w-full py-3 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90"
      >
        Acheter 100 messages
      </button>
    </CardShell>
  )
}
