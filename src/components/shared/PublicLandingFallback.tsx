/**
 * Contenu de secours pendant le chargement lazy de la landing.
 *
 * Il reste volontairement lisible et cohérent avec le HTML statique public :
 * les validateurs OAuth ne doivent jamais rencontrer un écran vide.
 */
export function PublicLandingFallback() {
  return (
    <div className="min-h-screen bg-theme-bg px-6 py-8 text-theme-ink">
      <header className="mx-auto max-w-5xl">
        <strong className="font-display text-xl">Arty</strong>
      </header>
      <main className="mx-auto max-w-5xl py-16">
        <h1 className="font-display text-4xl font-light tracking-tight">Arty</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-theme-ink/80">
          Arty est un assistant IA personnel qui réunit plusieurs modèles et permet de
          consulter et gérer votre agenda Google.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-theme-muted">
          Après connexion Google, Arty affiche les prochains événements de votre calendrier
          principal. Il ne crée, modifie ou supprime un événement qu&apos;à votre demande. Le
          brief proactif, désactivable dans les paramètres, peut utiliser ces événements pour
          préparer un résumé avec Anthropic (Claude), jamais pour la publicité.
        </p>
        <nav aria-label="Installation et informations légales" className="mt-8 flex flex-wrap gap-4 text-sm">
          <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/install/">
            Guide d&apos;installation
          </a>
          <a className="underline underline-offset-4" href="/privacy/">
            Politique de confidentialité
          </a>
          <a className="underline underline-offset-4" href="/terms/">
            Conditions d&apos;utilisation
          </a>
          <a className="underline underline-offset-4" href="/legal-notice/">
            Mentions légales
          </a>
        </nav>
      </main>
    </div>
  )
}
