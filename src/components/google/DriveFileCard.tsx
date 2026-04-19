import type { DriveFile } from '../../types/google'

interface DriveFileCardProps {
  file: DriveFile
  onClick?: () => void
}

function getMimeGlyph(mimeType: string): string {
  if (mimeType.includes('document') || mimeType.includes('text')) return '◰'
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv')) return '▦'
  if (mimeType.includes('presentation')) return '◈'
  if (mimeType.includes('pdf')) return '◰'
  if (mimeType.includes('image')) return '◼'
  if (mimeType.includes('folder')) return '▤'
  return '◯'
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
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
      className="w-full text-left p-3 mb-2 flex items-center gap-3 transition-opacity hover:opacity-90"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
      }}
    >
      <span className="text-lg flex-shrink-0" style={{ color: 'var(--arty-accent)' }}>
        {getMimeGlyph(file.mimeType)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[14px] truncate" style={{ color: 'var(--arty-ink)' }}>
          {file.name}
        </p>
        <p className="text-[11px] mt-0.5 font-serif italic" style={{ color: 'var(--arty-muted)' }}>
          Modifié le <span className="font-mono not-italic">{formatDate(file.modifiedTime)}</span>
        </p>
      </div>
      {file.webViewLink && (
        <a
          href={file.webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[12px] font-serif italic flex-shrink-0"
          style={{ color: 'var(--arty-accent)' }}
        >
          ouvrir →
        </a>
      )}
    </button>
  )
}
