import { memo, useEffect, useState } from 'react'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'
import {
  markBriefShown,
  scheduleMorningNotification,
  getGreeting,
  formatEventTime,
} from '../../services/morningBriefService'
import { Tag, Rule, DotLine } from '../shared/editorial'

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
    if (!isGoogleConnected) { setLoading(false); return }
    listEvents(1)
      .then((evts) => setEvents(evts.slice(0, 4)))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [isGoogleConnected, userName])

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  const handleQuickAction = (text: string) => {
    onClose()
    setTimeout(() => onSend(text), 150)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md overflow-hidden"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          borderRadius: 4,
          border: '1px solid var(--arty-line)',
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Masthead — date caplock + close, double rule en dessous */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[20px] leading-none"
            style={{ color: 'var(--arty-ink)' }}
            aria-label="Fermer"
          >
            ←
          </button>
          <Tag>{today}</Tag>
          <div className="flex-1" />
        </div>
        <Rule className="mx-6" />

        {/* Hero */}
        <div className="px-6 pt-5 pb-1">
          <Tag accent>◈ {getGreeting(userName)}</Tag>
          <h1 className="font-display mt-2 text-[34px] leading-[1.02] font-light tracking-[-0.02em]">
            La journée
            <br />
            <span className="italic" style={{ color: 'var(--arty-accent)' }}>commence fort.</span>
          </h1>
          <p className="font-serif italic mt-2 text-[15px] text-muted">
            {loading ? 'Lecture de ton agenda…' : events.length === 0 ? "Rien au programme aujourd'hui." : `${events.length} rendez-vous t'attendent.`}
          </p>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {/* I · Agenda */}
          {isGoogleConnected && (
            <section className="px-6 pt-5">
              <div
                className="flex justify-between items-baseline pb-2 mb-2"
                style={{ borderBottom: '1px solid var(--arty-ink)' }}
              >
                <Tag>I · Agenda</Tag>
                <span className="font-mono text-[10px] text-muted">
                  {loading ? '…' : `${events.length} rendez-vous`}
                </span>
              </div>
              {loading ? (
                <div className="space-y-2 py-2">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-12 rounded-sm animate-pulse"
                      style={{ backgroundColor: 'var(--arty-card)' }}
                    />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="font-serif italic text-[14px] text-muted py-2">
                  Aucun événement aujourd'hui.
                </p>
              ) : (
                <ul>
                  {events.map((event, i) => (
                    <li key={event.id}>
                      <div className="flex gap-4 py-3">
                        <span
                          className="font-mono text-[12px] font-bold w-14 shrink-0"
                          style={{ color: 'var(--arty-accent)' }}
                        >
                          {formatEventTime(event.start)}
                        </span>
                        <span className="font-serif text-[14px] leading-[1.25] flex-1">
                          {event.title}
                        </span>
                      </div>
                      {i < events.length - 1 && <DotLine />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* II · Actions rapides */}
          <section className="px-6 pt-5 pb-2">
            <div
              className="flex justify-between items-baseline pb-2 mb-2"
              style={{ borderBottom: '1px solid var(--arty-ink)' }}
            >
              <Tag>II · Actions rapides</Tag>
              <span className="font-mono text-[10px] text-muted">4 intentions</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { label: 'Résume mes emails', q: 'Résume mes emails non lus importants' },
                { label: 'Mon agenda', q: "Quels sont mes rendez-vous aujourd'hui ?" },
                { label: 'Mes priorités', q: "Aide-moi à organiser mes priorités pour aujourd'hui" },
                { label: 'Idée du jour', q: 'Donne-moi une idée ou conseil utile pour ma journée' },
              ].map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.q)}
                  className="text-left font-serif italic text-[13px] leading-[1.3] py-3 px-3 transition-colors"
                  style={{
                    color: 'var(--arty-ink)',
                    backgroundColor: 'var(--arty-card)',
                    border: '1px solid var(--arty-line)',
                    borderRadius: 2,
                  }}
                >
                  « {action.label} »
                </button>
              ))}
            </div>
          </section>

          {!isGoogleConnected && (
            <div
              className="mx-6 mt-4 mb-2 p-3 font-serif italic text-[13px] leading-[1.5]"
              style={{
                color: 'var(--arty-ink-soft)',
                border: '1px solid var(--arty-line)',
                borderLeft: '2px solid var(--arty-accent)',
                backgroundColor: 'var(--arty-card)',
                borderRadius: 2,
              }}
            >
              Connecte Google pour voir ton agenda et tes mails dans le brief.
            </div>
          )}
        </div>

        {/* Bouton principal */}
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={onClose}
            className="w-full font-display italic text-[17px] font-medium py-4 transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--arty-ink)',
              color: 'var(--arty-bg)',
              borderRadius: 2,
              letterSpacing: '0.02em',
            }}
          >
            Commencer la journée →
          </button>
        </div>
      </div>
    </div>
  )
}

export const MorningBrief = memo(MorningBriefInner)
