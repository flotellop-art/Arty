/**
 * P1.5 — Vue publique en lecture seule d'une conversation partagée.
 *
 * Accessible SANS compte (route hors auth). Charge le JSON depuis
 * /api/share/:id et rend chaque message via MarkdownRenderer. Bandeau
 * d'acquisition « Créé avec Arty — essaie gratuitement » (canal viral).
 * Aucune interaction (pas de sidebar, topbar d'actions, fact-check…).
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { ArtyWordmark } from '../shared/PrismMark'
import { apiUrl } from '../../services/apiBase'

interface SharedMessage {
  role: 'user' | 'assistant'
  content: string
}
interface SharedData {
  title: string
  payload: { title: string; messages: SharedMessage[]; usedModels?: string[]; createdAt?: number }
}

type State =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'ready'; data: SharedData }

export function SharedConversationView() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    if (!id) { setState({ kind: 'notfound' }); return }
    fetch(apiUrl(`/api/share/${id}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('not found'))))
      .then((data: SharedData) => { if (!cancelled) setState({ kind: 'ready', data }) })
      .catch(() => { if (!cancelled) setState({ kind: 'notfound' }) })
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="min-h-[100dvh] bg-theme-bg text-theme-ink">
      {/* Bandeau d'acquisition — le cœur viral : un visiteur découvre Arty. */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-theme-bg/90 backdrop-blur border-b border-theme-border"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
        <a href="/" className="flex items-center gap-2">
          <ArtyWordmark size={20} color="rgb(var(--theme-accent))" />
        </a>
        <a href="/"
          className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md hover:opacity-90 transition-opacity">
          {t('share.view.ctaHeader')}
        </a>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {state.kind === 'loading' && (
          <div className="space-y-3">
            <div className="h-6 w-2/3 rounded bg-theme-surface animate-pulse" />
            <div className="h-24 rounded-xl bg-theme-surface animate-pulse" />
            <div className="h-24 rounded-xl bg-theme-surface animate-pulse" />
          </div>
        )}

        {state.kind === 'notfound' && (
          <div className="text-center py-20">
            <p className="font-display text-xl text-theme-ink mb-2">{t('share.view.notFoundTitle')}</p>
            <p className="font-display italic text-sm text-theme-muted mb-6">
              {t('share.view.notFoundBody')}
            </p>
            <a href="/" className="inline-block px-4 py-2 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md">
              {t('share.view.notFoundCta')}
            </a>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <h1 className="font-display text-2xl text-theme-ink mb-6">{state.data.payload.title || state.data.title}</h1>
            <div className="space-y-5">
              {state.data.payload.messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <div className="max-w-[85%] font-display italic text-base text-theme-ink leading-snug text-right border-r-2 border-theme-accent pr-3 py-1 whitespace-pre-wrap break-words">
                      « {m.content} »
                    </div>
                  ) : (
                    <div className="max-w-[92%]">
                      <MarkdownRenderer content={m.content} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <footer className="mt-10 pt-6 border-t border-theme-border text-center">
              <p className="font-display italic text-sm text-theme-muted mb-3">
                {t('share.view.footerText')}
              </p>
              <a href="/" className="inline-block px-4 py-2 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md">
                {t('share.view.footerCta')}
              </a>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
