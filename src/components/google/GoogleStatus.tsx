import { useTranslation } from 'react-i18next'
import type { GoogleUser } from '../../types/google'

interface GoogleStatusProps {
  isConnected: boolean
  user: GoogleUser | null
  onLogout: () => void
}

export function GoogleStatus({ isConnected, user, onLogout }: GoogleStatusProps) {
  const { t } = useTranslation()
  if (!isConnected) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-theme-muted">
        <span className="w-2 h-2 rounded-full bg-theme-muted/40" />
        {t('googleStatus.disconnected')}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        {user?.email || t('googleStatus.connected')}
      </div>
      <button
        onClick={onLogout}
        className="text-xs text-theme-muted hover:text-red-500 transition-colors"
      >
        {t('googleStatus.logout')}
      </button>
    </div>
  )
}
