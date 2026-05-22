import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getReport } from '../../services/reportGenerator'
import { exportHtmlAsPdf } from '../../services/conversationExport'

export function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [html, setHtml] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (id) {
      const report = getReport(id)
      setHtml(report)
    }
  }, [id])

  // Listen for postMessage events from the sandboxed iframe (the report's
  // toolbar buttons). window.print() doesn't work inside an Android Chrome
  // sandboxed iframe, so the buttons relay their intent to the parent and
  // we handle export + back here using the same jsPDF/html2canvas pipeline
  // as the conversation export.
  useEffect(() => {
    if (!html) return
    const onMessage = async (e: MessageEvent) => {
      const data = e.data as { type?: string } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'arty-report-back') {
        navigate(-1)
        return
      }
      if (data.type === 'arty-report-export-pdf') {
        if (exporting) return
        setExporting(true)
        try {
          await exportHtmlAsPdf(html, 'arty-rapport', '#F2EBDE')
        } catch (err) {
          console.warn('Report PDF export failed:', err)
        } finally {
          setExporting(false)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [html, navigate, exporting])

  if (!html) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-theme-bg">
        <p className="text-theme-muted">Rapport introuvable</p>
      </div>
    )
  }

  return (
    <>
      {/*
        SÉCURITÉ : `html` est généré par l'IA et peut contenir du contenu hostile
        (prompt injection via un mail/une page lue). On NE met JAMAIS
        `allow-same-origin` avec `allow-scripts` sur un srcDoc : la combinaison
        permet à un script injecté d'accéder au localStorage/DOM du parent
        (exfiltration des tokens/clés). Sans `allow-same-origin`, l'iframe a une
        origine opaque : les scripts tournent (rapports interactifs) et les boutons
        relaient toujours par postMessage (cross-origin OK), mais ne peuvent plus
        toucher le parent. On retire aussi `allow-top-navigation` et
        `allow-popups-to-escape-sandbox` (redirection phishing + évasion sandbox).
      */}
      <iframe
        srcDoc={html}
        className="w-full h-[100dvh] border-0"
        title="Rapport"
        sandbox="allow-scripts allow-popups"
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
