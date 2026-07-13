import { useState } from 'react'
import { isPublicGoogleOAuthProfileEnabled } from '../../services/publicGoogleOAuthProfile'

interface SettingsGuideProps {
  onClose: () => void
}

export function SettingsGuide({ onClose }: SettingsGuideProps) {
  const [page, setPage] = useState<'style' | 'model'>('style')

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-theme-ink/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-sm bg-theme-surface rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors z-10"
          aria-label="Fermer"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Tabs */}
        <div className="flex border-b border-theme-border">
          <button
            onClick={() => setPage('style')}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              page === 'style'
                ? 'text-theme-accent border-b-2 border-theme-accent'
                : 'text-theme-muted'
            }`}
          >
            Tons
          </button>
          <button
            onClick={() => setPage('model')}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              page === 'model'
                ? 'text-theme-ink border-b-2 border-bubble-user'
                : 'text-theme-muted'
            }`}
          >
            Modèles IA
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[70vh]">
          {page === 'style' ? <StylePage /> : <ModelPage />}
        </div>
      </div>
    </div>
  )
}

function StylePage() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-theme-muted leading-relaxed">
        Change le ton des réponses d'Arty selon tes besoins.
      </p>

      <GuideItem
        emoji="💬"
        title="Normal"
        desc="Le mode par défaut. Arty parle naturellement, comme un pote qui s'y connaît. Direct et efficace."
      />
      <GuideItem
        emoji="⚡"
        title="Concis"
        desc="Réponses ultra-courtes, 1 à 3 phrases max. Idéal quand tu veux juste la réponse, sans blabla."
      />
      <GuideItem
        emoji="📝"
        title="Détaillé"
        desc="Explications approfondies avec exemples concrets et sous-titres. Pour bien comprendre un sujet."
      />
      <GuideItem
        emoji="👔"
        title="Formel"
        desc="Vouvoiement, ton professionnel et soigné. Parfait pour préparer un message client ou un e-mail."
      />
      <GuideItem
        emoji="⚙️"
        title="Technique"
        desc="Vocabulaire précis et termes exacts du domaine. Pour des réponses rigoureuses et spécialisées."
      />
    </div>
  )
}

function ModelPage() {
  const noCasaPhase0 = isPublicGoogleOAuthProfileEnabled()
  return (
    <div className="space-y-4">
      <p className="text-xs text-theme-muted leading-relaxed">
        Choisis quel modèle d'IA répond. Chacun a ses forces.
      </p>

      <GuideItem
        emoji="🔄"
        title="Auto"
        desc="Arty choisit le meilleur modèle selon ta question. Recherche web → Gemini, chat simple → Mistral, le reste → Claude."
      />
      <GuideItem
        emoji="🇺🇸"
        title="Claude"
        desc={noCasaPhase0
          ? "Le plus intelligent. Excellent pour raisonner, rédiger et analyser des documents. Dans ce test, il n'a aucun accès global à Gmail ou Drive."
          : "Le plus intelligent. Excellent pour raisonner, rédiger, analyser des documents et utiliser tes outils (Gmail, Drive, etc.)."}
      />
      <GuideItem
        emoji="🇪🇺"
        title="Mistral EU"
        desc="Modèle français, données hébergées en Europe. Rapide et économique. Idéal pour le chat quotidien."
      />
      <GuideItem
        emoji="🇺🇸"
        title="Gemini"
        desc="Le modèle de Google. Accès au web en temps réel, Google Maps, YouTube. Parfait pour les recherches et l'actualité."
      />
    </div>
  )
}

function GuideItem({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-lg mt-0.5 flex-shrink-0">{emoji}</span>
      <div>
        <p className="text-sm font-semibold text-theme-ink">{title}</p>
        <p className="text-xs text-theme-muted leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  )
}
