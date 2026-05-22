import { memo, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'
import {
  markBriefShown,
  scheduleMorningNotification,
  getGreeting,
  formatEventTime,
  buildBriefSpeechText,
} from '../../services/morningBriefService'
import { getDateLocale } from '../../utils/formatDate'
import { getValidAccessToken } from '../../services/googleAuth'
import { apiUrl } from '../../services/apiBase'

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

  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle')
  const [audioError, setAudioError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
    setAudioStatus('idle')
  }

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

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  const handlePlayPause = async () => {
    if (audioStatus === 'playing') {
      audioRef.current?.pause()
      return
    }

    if (audioStatus === 'paused' && audioRef.current) {
      try {
        await audioRef.current.play()
      } catch (e) {
        setAudioStatus('error')
        setAudioError(t('morningBrief.player.errorGeneric'))
      }
      return
    }

    let token: string | null = null
    try {
      token = await getValidAccessToken()
    } catch {
      // Ignored
    }

    if (!token) {
      setAudioStatus('error')
      setAudioError(t('morningBrief.player.connectGoogleToListen'))
      return
    }

    setAudioStatus('loading')
    setAudioError(null)

    try {
      let text = await buildBriefSpeechText(userName, isGoogleConnected)
      if (!text || !text.trim()) {
        setAudioStatus('error')
        setAudioError(t('morningBrief.player.errorGeneric'))
        return
      }

      if (text.length > 4096) {
        text = text.slice(0, 4096)
      }

      const res = await fetch(apiUrl('/api/ai/tts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-google-token': token,
        },
        body: JSON.stringify({ text, voice: 'alloy' }),
      })

      if (!res.ok) {
        setAudioStatus('error')
        if (res.status === 401) {
          setAudioError(t('morningBrief.player.error401'))
        } else if (res.status === 429) {
          setAudioError(t('morningBrief.player.error429'))
        } else if (res.status === 502) {
          setAudioError(t('morningBrief.player.error502'))
        } else {
          setAudioError(t('morningBrief.player.errorGeneric'))
        }
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }

      setAudioUrl(url)

      const audio = new Audio(url)
      audioRef.current = audio

      audio.addEventListener('playing', () => setAudioStatus('playing'))
      audio.addEventListener('pause', () => setAudioStatus('paused'))
      audio.addEventListener('ended', () => {
        setAudioStatus('idle')
        URL.revokeObjectURL(url)
        setAudioUrl(null)
      })
      audio.addEventListener('error', () => {
        setAudioStatus('error')
        setAudioError(t('morningBrief.player.errorGeneric'))
      })

      await audio.play()
    } catch (e) {
      setAudioStatus('error')
      setAudioError(t('morningBrief.player.errorGeneric'))
    }
  }

  const handleClose = () => {
    stopAudio()
    onClose()
  }

  const today = new Date().toLocaleDateString(getDateLocale(), {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  const handleQuickAction = (text: string) => {
    stopAudio()
    onClose()
    setTimeout(() => onSend(text), 150)
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-theme-ink/40 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-theme-bg text-theme-ink w-full sm:max-w-md rounded-t-3xl sm:rounded-sm shadow-2xl overflow-hidden border border-theme-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Editorial header — kicker + double rule + Fraunces hero */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              {t('morningBrief.kicker')}<span className="capitalize">{today}</span>
            </span>
            <button
              onClick={handleClose}
              className="text-theme-ink hover:bg-theme-ink/5 rounded p-1 transition-colors"
              aria-label={t('common.close')}
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
            {t('morningBrief.heroLine1')}<br />
            <span className="italic text-theme-accent">{t('morningBrief.heroLine2')}</span>
          </h1>
          <div className="flex items-center justify-between mt-3 gap-2">
            <p className="font-display italic text-theme-muted text-sm">
              {getGreeting(userName)}
            </p>
            <div className="flex items-center">
              {!isGoogleConnected ? (
                <button
                  disabled
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-theme-border text-theme-muted font-sans text-[11px] cursor-not-allowed opacity-60"
                  title={t('morningBrief.player.connectGoogleToListen')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                  <span>{t('morningBrief.player.listen')}</span>
                </button>
              ) : (
                <button
                  onClick={handlePlayPause}
                  disabled={audioStatus === 'loading'}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-theme-ink text-theme-bg hover:opacity-90 active:scale-95 transition-all font-sans text-[11px] font-medium shadow-sm"
                >
                  {audioStatus === 'loading' ? (
                    <>
                      <span className="w-3 h-3 border-2 border-theme-bg border-t-transparent rounded-full animate-spin" />
                      <span>{t('morningBrief.player.loading')}</span>
                    </>
                  ) : audioStatus === 'playing' ? (
                    <>
                      <div className="flex items-end gap-0.5 h-3 w-3 py-0.5">
                        <span className="w-[1.5px] bg-theme-bg rounded-full animate-wave-bar-1" />
                        <span className="w-[1.5px] bg-theme-bg rounded-full animate-wave-bar-2" />
                        <span className="w-[1.5px] bg-theme-bg rounded-full animate-wave-bar-3" />
                      </div>
                      <span>{t('morningBrief.player.pause')}</span>
                    </>
                  ) : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span>{t('morningBrief.player.listen')}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {audioError && (
          <div className="mx-6 mt-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-sm text-xs font-sans flex items-center justify-between">
            <span>{audioError}</span>
            <button onClick={() => setAudioError(null)} className="text-red-700/70 dark:text-red-400/70 hover:text-red-700 p-0.5 ml-2">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="px-6 py-5 space-y-6 max-h-[55vh] overflow-y-auto">

          {/* Agenda du jour — section éditoriale */}
          {isGoogleConnected && (
            <section>
              <div className="flex items-baseline justify-between border-b border-theme-ink pb-1.5 mb-3">
                <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                  I · {t('home.agendaKicker')}
                </span>
                {!loading && (
                  <span className="font-mono text-[10px] text-theme-muted">
                    {t('morningBrief.eventCount', { count: events.length })}
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
                  {t('morningBrief.noEvents')}
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
                II · {t('home.intentionsKicker')}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {[
                { label: t('morningBrief.actions.unreadEmails.label'), q: t('morningBrief.actions.unreadEmails.prompt') },
                { label: t('morningBrief.actions.today.label'), q: t('morningBrief.actions.today.prompt') },
                { label: t('morningBrief.actions.priorities.label'), q: t('morningBrief.actions.priorities.prompt') },
                { label: t('morningBrief.actions.idea.label'), q: t('morningBrief.actions.idea.prompt') },
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
                {t('morningBrief.connectGoogle')}
              </p>
            </div>
          )}
        </div>

        {/* Editorial CTA */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={handleClose}
            className="w-full bg-theme-ink text-theme-bg font-display italic text-[17px] font-medium tracking-[0.02em] rounded-sm py-4 hover:opacity-90 transition-opacity"
          >
            {t('morningBrief.startDay')} →
          </button>
        </div>
      </div>
    </div>
  )
}

export const MorningBrief = memo(MorningBriefInner)
