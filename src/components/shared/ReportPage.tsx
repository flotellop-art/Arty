import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getReport } from '../../services/reportGenerator'
import { exportHtmlAsPdf } from '../../services/conversationExport'
import { isCryptoReady } from '../../services/crypto'

export function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!id) {
        if (!cancelled) setLoading(false)
        return
      }
      // On a direct page refresh, useAuth may still be deriving the key. Its
      // conversation bootstrap emits the ready event below once crypto works.
      if (!isCryptoReady()) return

      setLoading(true)
      try {
        const report = await getReport(id)
        if (!cancelled) setHtml(report)
      } catch (err) {
        console.warn('Report load failed:', err)
        if (!cancelled) setHtml(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const onStorageReady = () => { void load() }
    window.addEventListener('conversations-storage-ready', onStorageReady)
    const timeout = window.setTimeout(() => {
      if (!cancelled && !isCryptoReady()) setLoading(false)
    }, 10_000)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      window.removeEventListener('conversations-storage-ready', onStorageReady)
    }
  }, [id])

  const handleExport = async () => {
    if (!html || exporting) return
    setExporting(true)
    try {
      await exportHtmlAsPdf(html, 'arty-rapport', '#F2EBDE')
    } catch (err) {
      console.warn('Report PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-theme-bg">
        <p className="text-theme-muted">Chargement du rapport…</p>
      </div>
    )
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-theme-bg">
        <p className="text-theme-muted">Rapport introuvable</p>
      </div>
    )
  }

  return (
    <>
      {/* Controls live in the trusted parent, never in model-generated HTML. */}
      <div
        className="fixed left-4 z-40 flex gap-2"
        style={{ top: 'max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-md bg-theme-ink px-3.5 py-2 text-[11px] font-semibold text-theme-bg shadow-sm"
        >
          ← Retour
        </button>
        <button
          type="button"
          onClick={() => { void handleExport() }}
          disabled={exporting}
          className="rounded-md bg-theme-accent px-3.5 py-2 text-[11px] font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {exporting ? 'Génération…' : 'Télécharger PDF'}
        </button>
      </div>

      {/*
        No script capability is granted. The stored document is sanitized and
        carries its own fail-closed CSP; the opaque sandbox origin remains an
        additional boundary against access to the parent application.
      */}
      <iframe
        srcDoc={html}
        className="w-full h-[100dvh] border-0"
        title="Rapport"
        sandbox="allow-popups"
      />

      {exporting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-theme-ink/40 pointer-events-none"
          aria-live="polite"
        >
          <div className="bg-theme-surface text-theme-ink px-4 py-2 rounded-xl text-sm shadow-lg">
            Génération du PDF…
          </div>
        </div>
      )}
    </>
  )
}
