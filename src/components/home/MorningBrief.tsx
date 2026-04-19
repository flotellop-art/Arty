import { memo, useEffect, useState } from 'react'
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-theme-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-bg text-theme-ink w-full sm:max-w-md rounded-t-3xl sm:rounded-sm shadow-2xl overflow-hidden border border-theme-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Editorial header — kicker + double rule + Fraunces hero */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              Le brief · <span className="capitalize">{today}</span>
            </span>
            <button
              onClick={onClose}
              className="text-theme-ink hover:bg-theme-ink/5 rounded p-1 transition-colors"
              aria-label="Fermer"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mx-6 h-[2px] bg-theme-ink" />
        <div className="mx-6 mt-[3px] h-px bg-theme-ink" />

        <div className="px-6 pt-6 pb-2">
          <h1 className="font-display font-medium text-[34px] leading-[1.02] -tracking-[0.02em] text-theme-ink">
            La journée<br />
            <span className="italic text-theme-accent">commence fort.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-2">
            {getGreeting(userName)}
          </p>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[55vh] overflow-y-auto">

          {/* Agenda du jour — section éditoriale */}
          {isGoogleConnected && (
            <section>
              <div className="flex items-baseline justify-between border-b border-theme-ink pb-1.5 mb-3">
                <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                  I · Agenda
                </span>
                {!loading && (
                  <span className="font-mono text-[10px] text-theme-muted">
                    {events.length} rendez-vous
                  </span>
                )}
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="h-10 bg-theme-ink/5 rounded-sm animate-pulse" />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="font-display italic text-sm text-theme-muted py-2">
                  Aucun événement aujourd'hui.
                </p>
              ) : (
                <ul>
                  {events.map((event, i) => (
                    <li
                      key={event.id}
                      className={`flex gap-4 py-2.5 ${
                        i === events.length - 1 ? '' : 'border-b border-dotted border-theme-border'
                      }`}
                    >
                      <span className="font-mono text-xs font-bold text-theme-accent w-12 shrink-0">
                        {formatEventTime(event.start)}
                      </span>
                      <span className="font-display text-sm text-theme-ink leading-snug truncate">
                        {event.title}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Actions rapides — intentions */}
          <section>
            <div className="flex items-baseline justify-between border-b border-theme-ink pb-1.5 mb-3">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                II · Intentions
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {[
                { label: 'Résume mes emails non lus', q: 'Résume mes emails non lus importants' },
                { label: 'Qu\'ai-je de prévu aujourd\'hui ?', q: 'Quels sont mes rendez-vous aujourd\'hui ?' },
                { label: 'Organise mes priorités', q: 'Aide-moi à organiser mes priorités pour aujourd\'hui' },
                { label: 'Donne-moi une idée utile', q: 'Donne-moi une idée ou conseil utile pour ma journée' },
              ].map(action => (
                <li key={action.label}>
                  <button
                    onClick={() => handleQuickAction(action.q)}
                    className="block w-full text-left font-display italic text-[14px] leading-[1.3] text-theme-ink border-l-2 border-theme-accent pl-3 py-1 hover:bg-theme-accent/5 transition-colors"
                  >
                    « {action.label} »
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Connexion Google si pas connecté */}
          {!isGoogleConnected && (
            <div className="border-l-2 border-theme-accent pl-3 py-2">
              <p className="font-display italic text-sm text-theme-muted">
                Connecte Google pour voir ton agenda et tes emails dans le brief.
              </p>
            </div>
          )}
        </div>

        {/* Editorial CTA */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={onClose}
            className="w-full bg-theme-ink text-theme-bg font-display italic text-[17px] font-medium tracking-[0.02em] rounded-sm py-4 hover:opacity-90 transition-opacity"
          >
            Commencer la journée →
          </button>
        </div>
      </div>
    </div>
  )
}

export const MorningBrief = memo(MorningBriefInner)
