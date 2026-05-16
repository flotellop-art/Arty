import type { GmailMessage } from '../../types/google'
import { getDateLocale } from '../../utils/formatDate'

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
    if (diffH < 24) return `il y a ${Math.floor(diffH)}h`
    return d.toLocaleDateString(getDateLocale(), { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function EmailCard({ email, onClick }: EmailCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-theme-surface rounded-xl border border-theme-border shadow-sm hover:shadow-md hover:border-theme-accent/20 transition-all p-3 mb-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-theme-ink truncate">
            {formatSender(email.from)}
          </p>
          <p className="text-sm text-theme-ink/80 truncate mt-0.5">
            {email.subject}
          </p>
          <p className="text-xs text-theme-muted truncate mt-1 leading-relaxed">
            {email.snippet}
          </p>
        </div>
        <span className="text-xs text-theme-muted flex-shrink-0 mt-0.5">
          {formatDate(email.date)}
        </span>
      </div>
    </button>
  )
}
