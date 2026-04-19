import { useState } from 'react'
import { Tag, Rule } from './editorial'

interface SettingsGuideProps {
  onClose: () => void
}

export function SettingsGuide({ onClose }: SettingsGuideProps) {
  const [page, setPage] = useState<'style' | 'model'>('style')

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose} />

      <div
        className="relative w-full max-w-sm max-h-[85vh] overflow-hidden"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          borderRadius: 4,
          border: '1px solid var(--arty-line)',
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
      >
        {/* Masthead */}
        <div className="px-5 pt-4 pb-2 flex items-center gap-3">
          <Tag>Guide</Tag>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 text-[16px]"
            style={{ color: 'var(--arty-muted)' }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <Rule className="mx-5" />

        {/* Tabs rail */}
        <div className="px-5 mt-3">
          <div className="flex items-center gap-6" style={{ borderBottom: '1px solid var(--arty-line)' }}>
            {[{ k: 'style', l: 'Tons' }, { k: 'model', l: 'Modèles IA' }].map((tab) => {
              const active = page === (tab.k as 'style' | 'model')
              return (
                <button
                  key={tab.k}
                  onClick={() => setPage(tab.k as 'style' | 'model')}
                  className="relative pb-2 text-[10px] tracking-[0.18em] uppercase font-semibold"
                  style={{ color: active ? 'var(--arty-ink)' : 'var(--arty-muted)' }}
                >
                  {tab.l}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 -bottom-px h-[2px]"
                      style={{ backgroundColor: 'var(--arty-accent)' }}
                    />
                  )}
                </button>
              )
            })}
          </div>
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
    <div className="space-y-3">
      <p className="font-serif italic text-[13px] leading-[1.5]" style={{ color: 'var(--arty-muted)' }}>
        Change le ton des réponses d'Arty selon tes besoins.
      </p>
      <GuideItem emoji="💬" title="Normal" desc="Le mode par défaut. Arty parle naturellement, direct et efficace." />
      <GuideItem emoji="⚡" title="Concis" desc="Ultra-courtes, 1 à 3 phrases max. La réponse, sans blabla." />
      <GuideItem emoji="📝" title="Détaillé" desc="Explications approfondies avec exemples et sous-titres." />
      <GuideItem emoji="👔" title="Formel" desc="Vouvoiement, ton soigné. Pour préparer un message client." />
      <GuideItem emoji="⚙️" title="Technique" desc="Vocabulaire précis, termes exacts. Réponses spécialisées." />
    </div>
  )
}

function ModelPage() {
  return (
    <div className="space-y-3">
      <p className="font-serif italic text-[13px] leading-[1.5]" style={{ color: 'var(--arty-muted)' }}>
        Choisis quel modèle d'IA répond. Chacun a ses forces.
      </p>
      <GuideItem emoji="🔄" title="Auto" desc="Arty choisit selon la question. Web → Gemini, chat → Mistral, le reste → Claude." />
      <GuideItem emoji="🇺🇸" title="Claude" desc="Le plus intelligent. Raisonner, rédiger, analyser, outils (Gmail, Drive)." />
      <GuideItem emoji="🇪🇺" title="Mistral EU" desc="Français, hébergé en Europe. Rapide et économique." />
      <GuideItem emoji="🇺🇸" title="Gemini" desc="Accès web temps réel, Maps, YouTube. Recherches et actualité." />
    </div>
  )
}

function GuideItem({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start py-2" style={{ borderBottom: '1px dotted var(--arty-line)' }}>
      <span className="text-base mt-0.5 flex-shrink-0">{emoji}</span>
      <div>
        <p className="font-display text-[14px] font-medium" style={{ color: 'var(--arty-ink)' }}>
          {title}
        </p>
        <p className="font-serif italic text-[12px] leading-[1.45] mt-0.5" style={{ color: 'var(--arty-muted)' }}>
          {desc}
        </p>
      </div>
    </div>
  )
}
