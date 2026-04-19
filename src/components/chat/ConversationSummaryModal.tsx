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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50" onClick={onClose}>
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="font-display text-lg text-theme-ink">📋 Résumé de la conversation</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted" aria-label="Fermer">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : summary ? (
            <MarkdownRenderer content={summary} />
          ) : (
            <p className="text-sm text-theme-muted/70 italic">Génération en cours...</p>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-theme-border">
          <button
            onClick={handleCopy}
            disabled={loading || !summary}
            className="flex-1 py-2 rounded-xl border border-theme-border text-sm font-medium text-theme-ink hover:bg-theme-ink/[0.03] disabled:opacity-50"
          >
            {copied ? '✓ Copié' : '📋 Copier'}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={loading || !summary}
            className="flex-1 py-2 rounded-xl bg-theme-accent text-theme-bg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            📄 Exporter PDF
          </button>
        </div>
      </div>
    </div>
  )
}
