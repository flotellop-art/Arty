import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../shared/BottomSheet'
import type { Conversation } from '../../types'

// Switcher de conversations (PR D) — ouvert par tap sur le titre du
// ChatTopBar. Avant : changer de conversation depuis le chat = 3 taps
// (retour → accueil → sidebar). Présentationnel : la navigation passe par
// onSelect (= handleSelectConversation d'App, qui gère état + route en une
// fois) — ne JAMAIS naviguer en direct d'ici.

interface ConversationSwitcherSheetProps {
  open: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId?: string
  onSelect: (id: string) => void
}

function relativeTime(ts: number, locale: string): string {
  const diffMin = Math.round((ts - Date.now()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffH = Math.round(diffMin / 60)
  if (Math.abs(diffH) < 24) return rtf.format(diffH, 'hour')
  return rtf.format(Math.round(diffH / 24), 'day')
}

export function ConversationSwitcherSheet({
  open,
  onClose,
  conversations,
  activeId,
  onSelect,
}: ConversationSwitcherSheetProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('en') ? 'en' : 'fr'

  // Tri défensif : la Sidebar consomme l'ordre du hook tel quel, mais ici on
  // veut garantir « plus récent en premier » quel que soit l'appelant.
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <BottomSheet open={open} onClose={onClose} title={t('chat.switcher.title')}>
      <ul>
        {sorted.map((conv) => {
          const active = conv.id === activeId
          return (
            <li key={conv.id}>
              <button
                onClick={() => {
                  onClose()
                  if (!active) onSelect(conv.id)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[13px] min-h-[48px] text-left border transition-colors ${
                  active
                    ? 'border-theme-accent/40 bg-theme-accent/[0.08]'
                    : 'border-transparent hover:bg-theme-ink/[0.03]'
                }`}
                aria-current={active ? 'true' : undefined}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-medium text-theme-ink truncate">
                    {conv.title}
                  </span>
                  <span className="block text-[11px] text-theme-muted mt-px">
                    {conv.euOnly && <span className="mr-1">🇪🇺</span>}
                    {relativeTime(conv.updatedAt, locale)}
                  </span>
                </span>
                {active && <span className="text-theme-accent text-[15px] shrink-0">✓</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </BottomSheet>
  )
}
