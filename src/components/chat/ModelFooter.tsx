import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatModelName,
  getModelCapacityKey,
  getModelExplanationKey,
  getModelRegion,
} from '../../services/modelLabels'

// CDC visibilité modèle (C-C) — footer discret sous chaque bulle assistant :
// LA surface primaire d'attribution (une seule — anti-objectif « fiche
// technique par bulle »). Deux niveaux :
//  - défaut : capacité en clair + drapeau région (« Recherche web · 🇺🇸 »)
//    — parle au grand public, pas de jargon imposé ;
//  - tap : nom précis + région en toutes lettres + explication générique
//    (« Claude Sonnet 5 · États-Unis » — réutilise getModelExplanationKey,
//    volontairement générique : jamais les triggers du routeur).
// Rendu UNIQUEMENT si Message.model existe (posé à finalize depuis la PR
// C-B) — les messages antérieurs au déploiement n'affichent rien.

interface ModelFooterProps {
  model: string
}

export const ModelFooter = memo(function ModelFooter({ model }: ModelFooterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const region = getModelRegion(model)

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-accent focus-visible:text-theme-accent transition-colors"
        aria-expanded={expanded}
        title={t('chat.modelFooter.hint')}
      >
        {expanded
          ? `${formatModelName(model)} · ${t(region.key)}`
          : `${t(getModelCapacityKey(model))} · ${region.flag}`}
      </button>
      {expanded && (
        <p className="mt-1 text-xs text-theme-muted leading-relaxed max-w-[60ch]">
          {t(getModelExplanationKey(model))}
        </p>
      )}
    </div>
  )
})
