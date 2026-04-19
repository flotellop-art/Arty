import type { GmailMessage } from '../../types/google'

interface EmailCardProps {
  email: GmailMessage
  onClick?: () => void
}

function formatSender(from: string): string {
  const match = from.match(/^(.+?)\s*</)
  return match ? match[1]!.replace(/"/g, '') : from
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60)
    if (diffH < 1) return "à l'instant"
    if (diffH < 24) return `${Math.floor(diffH)}h`
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function EmailCard({ email, onClick }: EmailCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 mb-2 transition-opacity hover:opacity-90"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--arty-accent)', boxShadow: '0 0 6px var(--arty-accent)' }}
            />
            <p className="font-display text-[14px] font-medium truncate" style={{ color: 'var(--arty-ink)' }}>
              {formatSender(email.from)}
            </p>
          </div>
          <p className="font-serif italic text-[13px] truncate mt-0.5" style={{ color: 'var(--arty-ink-soft)' }}>
            {email.subject}
          </p>
          <p className="text-[11px] truncate mt-1 leading-[1.45] font-serif" style={{ color: 'var(--arty-muted)' }}>
            {email.snippet}
          </p>
        </div>
        <span className="text-[10px] font-mono flex-shrink-0 mt-0.5" style={{ color: 'var(--arty-muted)' }}>
          {formatDate(email.date)}
        </span>
      </div>
    </button>
  )
}
