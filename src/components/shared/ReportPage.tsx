import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getReport } from '../../services/reportGenerator'
import { Tag, Rule } from './editorial'

export function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (id) setHtml(getReport(id))
  }, [id])

  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  if (!html) {
    return (
      <div
        className="flex flex-col items-center justify-center h-[100dvh] px-6 text-center"
        style={{ backgroundColor: 'var(--arty-bg)', color: 'var(--arty-ink)' }}
      >
        <Tag accent>◈ Rapport</Tag>
        <h1 className="font-display italic text-[32px] font-light mt-2 leading-[1.05]">
          Introuvable<span style={{ color: 'var(--arty-accent)' }}>.</span>
        </h1>
        <p className="font-serif italic mt-2 text-[14px]" style={{ color: 'var(--arty-muted)' }}>
          Ce rapport n'a pas pu être retrouvé dans ta bibliothèque.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 px-5 py-2 font-serif italic text-[13px]"
          style={{
            backgroundColor: 'var(--arty-ink)',
            color: 'var(--arty-bg)',
            borderRadius: 2,
          }}
        >
          ← Retour à l'accueil
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-[100dvh]"
      style={{ backgroundColor: 'var(--arty-bg)', color: 'var(--arty-ink)' }}
    >
      {/* Masthead éditorial */}
      <div className="px-5 pt-3 pb-2 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-[20px] leading-none"
          style={{ color: 'var(--arty-ink)' }}
          aria-label="Retour"
        >
          ←
        </button>
        <Tag>Rapport · {today}</Tag>
        <div className="flex-1" />
        <span className="font-mono text-[10px]" style={{ color: 'var(--arty-muted)' }}>
          p. 01
        </span>
      </div>
      <Rule className="mx-5" />

      {/* Iframe content */}
      <iframe
        srcDoc={html}
        className="w-full flex-1 border-0"
        title="Rapport"
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-top-navigation-by-user-activation"
      />
    </div>
  )
}
