import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getReport } from '../../services/reportGenerator'

export function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (id) {
      const report = getReport(id)
      setHtml(report)
    }
  }, [id])

  if (!html) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-cream">
        <p className="text-gray-400">Rapport introuvable</p>
      </div>
    )
  }

  return (
    <iframe
      srcDoc={html}
      className="w-full h-[100dvh] border-0"
      title="Rapport"
      sandbox="allow-same-origin allow-popups"
    />
  )
}
