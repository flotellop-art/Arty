import type { DriveFile } from '../../types/google'
import { getDateLocale } from '../../utils/formatDate'

interface DriveFileCardProps {
  file: DriveFile
  onClick?: () => void
}

function getMimeIcon(mimeType: string): string {
  if (mimeType.includes('document') || mimeType.includes('text')) return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('presentation')) return '📽️'
  if (mimeType.includes('pdf')) return '📕'
  if (mimeType.includes('image')) return '🖼️'
  if (mimeType.includes('folder')) return '📁'
  return '📎'
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(getDateLocale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export function DriveFileCard({ file, onClick }: DriveFileCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-theme-surface rounded-xl border border-theme-border shadow-sm hover:shadow-md hover:border-theme-accent/20 transition-all p-3 mb-2 flex items-center gap-3"
    >
      <span className="text-xl flex-shrink-0">{getMimeIcon(file.mimeType)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-normal text-theme-ink truncate">{file.name}</p>
        <p className="text-xs text-theme-muted mt-0.5">
          Modifié le {formatDate(file.modifiedTime)}
        </p>
      </div>
      {file.webViewLink && (
        <a
          href={file.webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-theme-accent hover:underline flex-shrink-0"
        >
          Ouvrir
        </a>
      )}
    </button>
  )
}
