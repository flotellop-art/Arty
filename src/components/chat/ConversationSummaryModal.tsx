import { useEffect, useState } from 'react'
import type { Conversation } from '../../types'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { streamMessage } from '../../services/anthropicClient'
import { openReport } from '../../services/reportGenerator'

// Minimal markdown → HTML conversion for PDF export.
function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    const li = line.match(/^[-*]\s+(.*)$/)
    if (h) {
      if (inList) { out.push('</ul>'); inList = false }
      const level = h[1]!.length + 1
      out.push(`<h${level}>${escapeHtml(h[2] || '')}</h${level}>`)
    } else if (li) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inlineMd(li[1] || '')}</li>`)
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('')
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<p>${inlineMd(line)}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)
}

function inlineMd(s: string): string {
  let r = escapeHtml(s)
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  r = r.replace(/`([^`]+)`/g, '<code>$1</code>')
  return r
}

interface Props {
  conversation: Conversation
  onClose: () => void
}

export function ConversationSummaryModal({ conversation, onClose }: Props) {
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Build a compact transcript (truncate long messages)
    const transcript = conversation.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const txt = m.content.length > 2000 ? m.content.slice(0, 2000) + '...' : m.content
        return `${m.role === 'user' ? 'Utilisateur' : 'Arty'}: ${txt}`
      })
      .join('\n\n')

    const prompt = [
      { role: 'user', content: `Génère un résumé structuré de cette conversation avec : points clés, décisions prises, actions à faire. Format Markdown.\n\n--- CONVERSATION ---\n${transcript}` },
    ]

    let cancelled = false
    let accumulated = ''

    const controller = streamMessage(
      prompt as Array<{ role: string; content: string }>,
      (token) => {
        if (cancelled) return
        accumulated += token
        setSummary(accumulated)
      },
      () => { if (!cancelled) setLoading(false) },
      (err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      },
      {
        systemPrompt: 'Tu es un assistant qui produit des résumés clairs et structurés en Markdown. Ne pose pas de questions, produis directement le résumé demandé.',
      }
    )

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [conversation])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const handleExportPdf = () => {
    try {
      const html = mdToHtml(summary)
      const reportId = openReport(`Résumé — ${conversation.title}`, html)
      window.open(`/report/${reportId}`, '_blank')
    } catch (err) {
      console.warn('Export PDF failed:', err)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          border: '1px solid var(--arty-line)',
          borderRadius: 4,
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Masthead */}
        <div className="px-5 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[20px] leading-none"
            style={{ color: 'var(--arty-ink)' }}
            aria-label="Fermer"
          >
            ←
          </button>
          <span className="text-[10px] tracking-[0.18em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-muted)' }}>
            Résumé · {conversation.title.slice(0, 40)}
          </span>
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
        <div className="mx-5" style={{ height: 2, backgroundColor: 'var(--arty-ink)' }} />
        <div className="mx-5 mt-[3px]" style={{ height: 1, backgroundColor: 'var(--arty-ink)' }} />

        {/* Hero */}
        <div className="px-5 pt-4 pb-2">
          <span className="text-[10px] tracking-[0.18em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-accent)' }}>
            ◈ Synthèse
          </span>
          <h1 className="font-display text-[26px] leading-[1.05] font-light tracking-[-0.02em] mt-1">
            Points clés &
            <br />
            <span className="italic" style={{ color: 'var(--arty-accent)' }}>décisions prises.</span>
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          {error ? (
            <p
              className="text-[13px] font-serif italic px-3 py-2"
              style={{
                color: 'var(--arty-accent)',
                backgroundColor: 'var(--arty-accent-glow)',
                borderLeft: '2px solid var(--arty-accent)',
                borderRadius: 2,
              }}
            >
              {error}
            </p>
          ) : summary ? (
            <MarkdownRenderer content={summary} />
          ) : (
            <p className="text-[14px] font-serif italic" style={{ color: 'var(--arty-muted)' }}>
              Arty synthétise…
            </p>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--arty-line)' }}>
          <button
            onClick={handleCopy}
            disabled={loading || !summary}
            className="flex-1 py-2 font-serif italic text-[13px] disabled:opacity-50"
            style={{ border: '1px solid var(--arty-line)', color: 'var(--arty-ink)', borderRadius: 2 }}
          >
            {copied ? '✓ Copié' : 'Copier'}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={loading || !summary}
            className="flex-1 py-2 font-display italic text-[13px] font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--arty-ink)', color: 'var(--arty-bg)', borderRadius: 2 }}
          >
            Exporter PDF →
          </button>
        </div>
      </div>
    </div>
  )
}
