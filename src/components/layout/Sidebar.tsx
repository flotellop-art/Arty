import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../types'
import { StarIcon } from '../shared/StarIcon'
import { TokenUsageBar } from '../shared/TokenUsageBar'
import { LanguageSelector } from '../shared/LanguageSelector'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onNewEU?: () => void
  onDelete: (id: string) => void
  userName?: string
  onLogout?: () => void
}

function useTimeAgo() {
  const { t } = useTranslation()
  return (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return t('sidebar.timeAgo.now')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('sidebar.timeAgo.minutes', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('sidebar.timeAgo.hours', { count: hours })
    const days = Math.floor(hours / 24)
    return t('sidebar.timeAgo.days', { count: days })
  }
}

export function Sidebar({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNew,
  onNewEU,
  onDelete,
  userName,
  onLogout,
}: SidebarProps) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
          <StarIcon size={28} />
          <h2 className="font-serif text-lg font-semibold text-bubble-user">
            Arty
          </h2>
        </div>

        {/* New conversation */}
        <div className="px-4 py-3">
          <button
            onClick={() => {
              onNew()
              onClose()
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-bubble-user"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="8" y1="2" x2="8" y2="14" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="2" y1="8" x2="14" y2="8" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('sidebar.newConversation')}
          </button>
          {onNewEU && (
            <button
              onClick={() => {
                onNewEU()
                onClose()
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-sm font-medium text-blue-700 mt-2"
            >
              <span className="text-base">🇪🇺</span>
              {t('sidebar.newConversationEU')}
            </button>
          )}
        </div>

        {/* Conversation list */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              {t('sidebar.emptyList')}
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl mb-0.5 cursor-pointer transition-colors ${
                conv.id === activeId
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-gray-50 text-bubble-user'
              }`}
            >
              <button
                onClick={() => {
                  onSelect(conv.id)
                  onClose()
                }}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm truncate font-normal">{conv.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {timeAgo(conv.updatedAt)}
                </p>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all"
                aria-label={t('sidebar.deleteAria')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 4H12L11 13H3L2 4Z" stroke="#EF4444" strokeWidth="1.2" />
                  <path d="M5 4V2H9V4" stroke="#EF4444" strokeWidth="1.2" />
                  <line x1="1" y1="4" x2="13" y2="4" stroke="#EF4444" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          ))}
        </nav>

        <TokenUsageBar />

        {/* Language selector */}
        <LanguageSelector />

        {/* User info + logout */}
        {userName && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500 truncate">{userName}</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                {t('common.logout')}
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
