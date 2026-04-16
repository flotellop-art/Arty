import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'
import {
  markBriefShown,
  scheduleMorningNotification,
  getGreeting,
  formatEventTime,
} from '../../services/morningBriefService'

interface Props {
  onClose: () => void
  onSend: (text: string) => void
  userName?: string
  isGoogleConnected: boolean
}

function MorningBriefInner({ onClose, onSend, userName, isGoogleConnected }: Props) {
  const { t } = useTranslation()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    markBriefShown()
    scheduleMorningNotification(userName)

    if (!isGoogleConnected) {
      setLoading(false)
      return
    }

    listEvents(1)
      .then((evts) => setEvents(evts.slice(0, 4)))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [isGoogleConnected, userName])

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  const handleQuickAction = (text: string) => {
    onClose()
    setTimeout(() => onSend(text), 150)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-6 pt-8 pb-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/70 text-sm font-medium capitalize">{today}</p>
              <h1 className="text-2xl font-bold mt-1">{getGreeting(userName)}</h1>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              aria-label="Fermer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">

          {/* Agenda du jour */}
          {isGoogleConnected && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                📅 Aujourd'hui
              </h2>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">Aucun événement aujourd'hui 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {events.map(event => (
                    <li
                      key={event.id}
                      className="flex items-center gap-3 bg-indigo-50 rounded-xl px-3 py-2.5"
                    >
                      <span className="text-indigo-400 font-semibold text-xs w-16 shrink-0 text-right">
                        {formatEventTime(event.start)}
                      </span>
                      <span className="text-sm text-gray-800 font-medium truncate">{event.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Actions rapides */}
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              ⚡ Actions rapides
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '📧', label: 'Résume mes emails', q: 'Résume mes emails non lus importants' },
                { icon: '📅', label: 'Mon agenda', q: 'Quels sont mes rendez-vous aujourd\'hui ?' },
                { icon: '✅', label: 'Ma to-do', q: 'Aide-moi à organiser mes priorités pour aujourd\'hui' },
                { icon: '🧠', label: 'Idée du jour', q: 'Donne-moi une idée ou conseil utile pour ma journée' },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.q)}
                  className="flex items-center gap-2 text-left bg-gray-50 hover:bg-gray-100 rounded-xl px-3 py-2.5 transition-colors"
                >
                  <span className="text-lg">{action.icon}</span>
                  <span className="text-xs font-medium text-gray-700">{action.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Connexion Google si pas connecté */}
          {!isGoogleConnected && (
            <div className="bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-800">
              💡 Connecte Google pour voir ton agenda et tes emails dans le brief.
            </div>
          )}
        </div>

        {/* Bouton principal */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={onClose}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-2xl py-3.5 transition-colors"
          >
            Commencer la journée →
          </button>
        </div>
      </div>
    </div>
  )
}

export const MorningBrief = memo(MorningBriefInner)
