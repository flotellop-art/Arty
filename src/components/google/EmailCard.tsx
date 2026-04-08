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
    if (diffH < 24) return `il y a ${Math.floor(diffH)}h`
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function EmailCard({ email, onClick }: EmailCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-accent/20 transition-all p-3 mb-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-bubble-user truncate">
            {formatSender(email.from)}
          </p>
          <p className="text-sm text-bubble-user/80 truncate mt-0.5">
            {email.subject}
          </p>
          <p className="text-xs text-gray-400 truncate mt-1 leading-relaxed">
            {email.snippet}
          </p>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
          {formatDate(email.date)}
        </span>
      </div>
    </button>
  )
}
