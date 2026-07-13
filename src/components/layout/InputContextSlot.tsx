import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuickActionId } from '../../types'

// Slot contextuel unique au-dessus de l'InputBar (PR C, design/mockups-2026-06/
// PLAN.md). Remplace les 7 bandeaux concurrents qui s'empilaient sans
// hiérarchie. Priorité : voix > erreur > calendrier > chips — avec une
// exception de sécurité NON négociable : quand un enregistrement / une
// transcription est en cours, l'indicateur voix reste TOUJOURS visible et
// l'erreur s'affiche EN PLUS au-dessus, jamais à sa place (un micro chaud
// invisible = leak perçu — audit PR C, risque critique R1).
//
// Volontairement présentationnel et sans effet : toute la mécanique micro
// (refs MediaRecorder, timers, hold) reste dans InputBar — frontière
// BUG 44/46. Les markups voix reprennent ceux de l'ancien rendu à
// l'identique pour ne pas changer le langage visuel pendant la beta.

export interface ContextChip {
  id: QuickActionId
  label: string
  icon: string
}

interface InputContextSlotProps {
  /** Première erreur active (mic / audio / fichier / enhancer), sinon null. */
  error: string | null
  /** Présent uniquement quand l'erreur est dismissible (enhancer). */
  onDismissError?: () => void
  isRecordingAudio: boolean
  recordingDuration: number
  isSwipeCancelling: boolean
  isTranscribing: boolean
  isListening: boolean
  interimTranscript: string
  calendarSuggestion: { text: string } | null
  onCreateCalendarEvent: () => void
  onDismissCalendar: () => void
  /** Conditions chips calculées par InputBar (texte vide, pas de fichier…). */
  showChips: boolean
  chips: ContextChip[]
  activeChipId?: QuickActionId
  onChipClick: (id: QuickActionId) => void
  /** Pastille Réflexion (ReflectionPill) rendue SOUS la rangée de chips,
      uniquement à l'idle — même cycle de vie que les chips : visible quand
      le textarea est vide, disparaît dès la frappe (« ne gêne pas lors de
      la saisie », audit UX 12 juin). Hors de la rangée scrollable pour que
      son popover ne soit pas rogné par l'overflow-x. */
  reflectionSlot?: ReactNode
}

export function InputContextSlot({
  error,
  onDismissError,
  isRecordingAudio,
  recordingDuration,
  isSwipeCancelling,
  isTranscribing,
  isListening,
  interimTranscript,
  calendarSuggestion,
  onCreateCalendarEvent,
  onDismissCalendar,
  showChips,
  chips,
  activeChipId,
  onChipClick,
  reflectionSlot,
}: InputContextSlotProps) {
  const { t } = useTranslation()

  const voiceActive = isRecordingAudio || isTranscribing || (isListening && !!interimTranscript)

  return (
    <>
      {/* Erreur — co-affichée avec la voix (jamais à sa place), exclusive sinon. */}
      {error && (
        <div
          className="mb-2 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-700 dark:text-red-400"
          role="alert"
        >
          <span>⚠️</span>
          <span className="flex-1 truncate">{error}</span>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="hover:opacity-70 transition-opacity"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {voiceActive ? (
        <>
          {isRecordingAudio && (
            <div
              className={`mb-1 px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                isSwipeCancelling
                  ? 'bg-red-500/15 text-red-700 dark:text-red-400 font-semibold'
                  : 'bg-theme-ink/5 text-theme-muted'
              }`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  isSwipeCancelling ? 'bg-red-600' : 'bg-red-500 animate-pulse'
                }`}
              />
              <span className="font-mono tabular-nums">
                {recordingDuration.toString().padStart(2, '0')}s
              </span>
              <span className="flex-1 truncate">
                {isSwipeCancelling
                  ? t('chat.input.voice.releaseToCancel')
                  : t('chat.input.voice.recording')}
              </span>
              {!isSwipeCancelling && (
                <span className="text-[10px] opacity-70 whitespace-nowrap">
                  {t('chat.input.voice.swipeToCancel')}
                </span>
              )}
            </div>
          )}
          {isListening && interimTranscript && (
            <div className="text-xs text-theme-muted italic mb-1 px-1 truncate">
              {interimTranscript}...
            </div>
          )}
          {isTranscribing && !isRecordingAudio && (
            <div className="text-xs text-theme-muted italic mb-1 px-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-theme-accent animate-pulse" />
              {t('chat.input.voice.transcribing')}
            </div>
          )}
        </>
      ) : !error && calendarSuggestion ? (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-xl text-xs text-theme-ink">
          <span>📅</span>
          <span className="flex-1 truncate">
            {t('calendar.suggestionPillPrefix')}
            <span className="font-semibold">{calendarSuggestion.text}</span>
          </span>
          <button
            onClick={onCreateCalendarEvent}
            className="px-2 py-0.5 rounded-md bg-theme-accent text-theme-bg text-[10px] font-semibold hover:opacity-90"
          >
            {t('calendar.create')}
          </button>
          <button
            onClick={onDismissCalendar}
            className="text-theme-muted hover:text-theme-ink"
            aria-label={t('calendar.dismissSuggestion')}
          >
            ✕
          </button>
        </div>
      ) : !error && showChips ? (
        <>
          <div
            className="mb-2 flex flex-nowrap overflow-x-auto gap-1.5 px-1 pb-0.5"
            style={{ scrollbarWidth: 'none' }}
          >
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChipClick(chip.id)}
                aria-pressed={activeChipId === chip.id}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  activeChipId === chip.id
                    ? 'bg-theme-accent text-theme-bg border-theme-accent'
                    : 'bg-theme-surface border-theme-border text-theme-ink hover:border-theme-accent hover:text-theme-accent'
                }`}
                aria-label={t('chat.input.chipSuggestion', { label: chip.label })}
              >
                {chip.icon} {chip.label}
              </button>
            ))}
          </div>
          {reflectionSlot && <div className="mb-1.5 px-1 -mt-0.5">{reflectionSlot}</div>}
        </>
      ) : null}
    </>
  )
}
