/**
 * Landing marketing tryarty.com — item 16 de la roadmap v2 (P0 pré-launch).
 *
 * Rendue à `/` UNIQUEMENT pour un primo-visiteur web non authentifié :
 * jamais en natif Capacitor, jamais si une session est connue, jamais si
 * l'onboarding a déjà été fait (voir LoggedOutHome dans App.tsx).
 * Lazy-loadée pour ne pas alourdir le chunk critique des utilisateurs
 * connectés (pattern H-Perf-2).
 *
 * Discipline copy (audit concurrentiel 12 juin 2026 + anti-objectifs) :
 * - jamais « illimité »/« unlimited » sur les modèles — la formulation
 *   validée est « sans plafond mensuel » (garde-fou testé en CI) ;
 * - la privacy n'est pas l'argument n°1 : section confiance APRÈS features ;
 * - le pricing reprend mot pour mot les clés upgrade.* (source de vérité) ;
 * - pas d'accès Gmail/Drive revendiqué : le profil OAuth public ne demande
 *   que calendar.events (PR #343/#344) — agenda + contenus joints/collés.
 */
import { useTranslation } from 'react-i18next'
import { ArtyWordmark } from '../components/shared/PrismMark'

interface LandingScreenProps {
  /** CTA « Essayer gratuitement » — révèle l'écran de choix d'onboarding. */
  onStart: () => void
  /** « Se connecter » — utilisateur qui a déjà un compte. */
  onLogin: () => void
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-kicker text-theme-accent mb-3">
      {children}
    </p>
  )
}

function CtaButton({
  onClick,
  children,
  large = false,
}: {
  onClick: () => void
  children: React.ReactNode
  large?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg bg-theme-ink text-theme-bg font-sans font-semibold transition-colors hover:bg-theme-accent ${
        large ? 'px-8 py-4 text-lg' : 'px-5 py-2.5 text-sm'
      }`}
    >
      {children}
    </button>
  )
}

export function LandingScreen({ onStart, onLogin }: LandingScreenProps) {
  const { t } = useTranslation()

  const features = ['models', 'calendar', 'files', 'voice'] as const
  const trust = ['limits', 'noSwitch', 'privacy', 'byok'] as const
  const faqItems = ['1', '2', '3', '4', '5', '6', '7'] as const

  return (
    <div className="min-h-screen bg-theme-bg text-theme-ink">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <ArtyWordmark size={24} />
        <nav className="flex items-center gap-4">
          <button
            type="button"
            onClick={onLogin}
            className="text-sm font-medium text-theme-muted transition-colors hover:text-theme-ink"
          >
            {t('landing.nav.login')}
          </button>
          <CtaButton onClick={onStart}>{t('landing.nav.cta')}</CtaButton>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <Kicker>{t('landing.hero.kicker')}</Kicker>
          <h1 className="max-w-3xl font-display text-4xl font-light leading-tight tracking-tight sm:text-6xl">
            {t('landing.hero.titleMain')}{' '}
            <em className="text-theme-accent">{t('landing.hero.titleAccent')}</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-theme-ink/80 sm:text-xl">
            {t('landing.hero.lede')}
          </p>
          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <CtaButton large onClick={onStart}>
              {t('landing.hero.cta')}
            </CtaButton>
            <a
              href="#pricing"
              className="text-sm font-medium text-theme-muted underline underline-offset-4 transition-colors hover:text-theme-ink"
            >
              {t('landing.hero.secondary')}
            </a>
          </div>
          <p className="mt-4 text-sm text-theme-muted">{t('landing.hero.ctaNote')}</p>
        </section>

        {/* ── Problème ─────────────────────────────────────────────── */}
        <section className="border-t border-theme-border py-16">
          <Kicker>{t('landing.problem.kicker')}</Kicker>
          <h2 className="max-w-2xl font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.problem.title')}
          </h2>
          <div className="mt-6 grid max-w-4xl gap-6 sm:grid-cols-2">
            <p className="leading-relaxed text-theme-ink/80">{t('landing.problem.p1')}</p>
            <p className="leading-relaxed text-theme-ink/80">{t('landing.problem.p2')}</p>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────── */}
        <section className="border-t border-theme-border py-16">
          <Kicker>{t('landing.features.kicker')}</Kicker>
          <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.features.title')}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {features.map((key) => (
              <article
                key={key}
                className="rounded-[14px] border border-theme-border bg-theme-surface p-6"
              >
                <h3 className="font-sans text-base font-semibold">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-theme-ink/80">
                  {t(`landing.features.${key}.text`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Confiance (volontairement APRÈS les features) ────────── */}
        <section className="border-t border-theme-border py-16">
          <Kicker>{t('landing.trust.kicker')}</Kicker>
          <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.trust.title')}
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {trust.map((key) => (
              <div key={key}>
                <h3 className="font-sans text-base font-semibold">
                  {t(`landing.trust.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-theme-ink/80">
                  {t(`landing.trust.${key}.text`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────── */}
        <section id="pricing" className="scroll-mt-8 border-t border-theme-border py-16">
          <Kicker>{t('landing.pricing.kicker')}</Kicker>
          <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.pricing.title')}
          </h2>
          <p className="mt-4 inline-block rounded-lg bg-theme-accent/10 px-4 py-2 text-sm font-medium">
            {t('landing.pricing.trialCallout')}
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {/* BYOK */}
            <article className="flex flex-col rounded-[14px] border border-theme-border bg-theme-surface p-6">
              <h3 className="font-sans text-base font-semibold">{t('landing.pricing.byokName')}</h3>
              <p className="mt-1 font-display text-2xl">{t('landing.pricing.byokPrice')}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-theme-ink/80">
                {t('landing.pricing.byokDesc')}
              </p>
              <div className="mt-5">
                <CtaButton onClick={onStart}>{t('landing.pricing.cardCta')}</CtaButton>
              </div>
            </article>
            {/* Abonnement (mise en avant) */}
            <article className="relative flex flex-col rounded-[14px] border-2 border-theme-accent bg-theme-surface p-6">
              <span className="absolute -top-3 left-6 rounded-full bg-theme-accent px-3 py-0.5 font-mono text-[10px] uppercase tracking-kicker text-white">
                {t('landing.pricing.subBadge')}
              </span>
              <h3 className="font-sans text-base font-semibold">{t('landing.pricing.subName')}</h3>
              <p className="mt-1 font-display text-2xl">{t('landing.pricing.subPrice')}</p>
              <p className="mt-3 text-sm leading-relaxed text-theme-ink/80">
                {t('landing.pricing.subDesc')}
              </p>
              <p className="mt-3 flex-1 text-xs text-theme-muted">
                {t('landing.pricing.subReassurance')}
              </p>
              <div className="mt-5">
                <CtaButton onClick={onStart}>{t('landing.pricing.cardCta')}</CtaButton>
              </div>
            </article>
            {/* Pro */}
            <article className="flex flex-col rounded-[14px] border border-theme-border bg-theme-surface p-6">
              <h3 className="font-sans text-base font-semibold">{t('landing.pricing.proName')}</h3>
              <p className="mt-1 font-display text-2xl">{t('landing.pricing.proPrice')}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-theme-ink/80">
                {t('landing.pricing.proDesc')}
              </p>
              <div className="mt-5">
                <CtaButton onClick={onStart}>{t('landing.pricing.cardCta')}</CtaButton>
              </div>
            </article>
          </div>
          <p className="mt-6 text-sm text-theme-ink/80">{t('landing.pricing.extras')}</p>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-theme-muted">
            {t('landing.pricing.transparency')}
          </p>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────── */}
        <section className="border-t border-theme-border py-16">
          <Kicker>{t('landing.faq.kicker')}</Kicker>
          <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.faq.title')}
          </h2>
          <div className="mt-8 max-w-3xl divide-y divide-theme-border border-y border-theme-border">
            {faqItems.map((n) => (
              <details key={n} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-sans text-base font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`landing.faq.q${n}`)}
                  <span
                    aria-hidden
                    className="text-theme-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-theme-ink/80">
                  {t(`landing.faq.a${n}`)}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA final ────────────────────────────────────────────── */}
        <section className="border-t border-theme-border py-16 text-center">
          <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
            {t('landing.finalCta.title')}
          </h2>
          <div className="mt-8">
            <CtaButton large onClick={onStart}>
              {t('landing.hero.cta')}
            </CtaButton>
          </div>
          <p className="mt-4 text-sm text-theme-muted">{t('landing.hero.ctaNote')}</p>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-theme-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 py-8 text-center text-xs text-theme-muted sm:flex-row sm:justify-between sm:text-left">
          <p>{t('landing.footer.madeIn')}</p>
          <nav className="flex items-center gap-4">
            <a href="/privacy/" className="underline underline-offset-4 hover:text-theme-ink">
              {t('landing.footer.privacy')}
            </a>
            <button
              type="button"
              onClick={onLogin}
              className="underline underline-offset-4 hover:text-theme-ink"
            >
              {t('landing.footer.login')}
            </button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
