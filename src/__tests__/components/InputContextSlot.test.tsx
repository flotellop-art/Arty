// Tests de la logique de priorité du slot contextuel (PR C).
// Rendu statique via react-dom/server — pas de @testing-library nécessaire,
// le composant est purement présentationnel.
//
// Invariant de sécurité testé en priorité (audit PR C, risque critique R1) :
// une erreur ne masque JAMAIS l'indicateur d'enregistrement en cours — un
// micro chaud invisible serait perçu comme un leak.

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InputContextSlot } from '../../components/layout/InputContextSlot'

vi.mock('react-i18next', () => ({
  // t() renvoie la clé — suffisant pour des assertions de présence.
  useTranslation: () => ({ t: (key: string) => key }),
}))

const baseProps = {
  error: null as string | null,
  onDismissError: undefined as (() => void) | undefined,
  isRecordingAudio: false,
  recordingDuration: 0,
  isSwipeCancelling: false,
  isTranscribing: false,
  isListening: false,
  interimTranscript: '',
  calendarSuggestion: null as { text: string } | null,
  onCreateCalendarEvent: () => {},
  onDismissCalendar: () => {},
  showChips: false,
  chips: [{ id: 'summarize' as const, label: 'Résumer', icon: '📝' }],
  activeChipId: undefined,
  onChipClick: () => {},
}

describe('InputContextSlot — reflectionSlot (pastille Réflexion)', () => {
  const pill = <span data-testid="pill">PILL-REFLEXION</span>

  it('rendu avec les chips (idle)', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} showChips={true} reflectionSlot={pill} />
    )
    expect(html).toContain('PILL-REFLEXION')
  })

  it('PAS rendu pendant la frappe (showChips=false) — « ne gêne pas la saisie »', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} showChips={false} reflectionSlot={pill} />
    )
    expect(html).not.toContain('PILL-REFLEXION')
  })

  it('PAS rendu quand la voix est active (priorité voix)', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} showChips={true} isRecordingAudio={true} reflectionSlot={pill} />
    )
    expect(html).not.toContain('PILL-REFLEXION')
  })
})

describe('InputContextSlot — priorité voix > erreur > calendrier > chips', () => {
  it('CRITIQUE (R1) : erreur + enregistrement → les DEUX visibles, jamais l\'un sans l\'autre', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot
        {...baseProps}
        error="Transcription échouée"
        isRecordingAudio={true}
        recordingDuration={7}
      />
    )
    expect(html).toContain('Transcription échouée')
    expect(html).toContain('chat.input.voice.recording')
    expect(html).toContain('07s')
  })

  it('erreur + transcription en cours → les deux visibles', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} error="Erreur réseau" isTranscribing={true} />
    )
    expect(html).toContain('Erreur réseau')
    expect(html).toContain('chat.input.voice.transcribing')
  })

  it('erreur seule → masque calendrier et chips', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot
        {...baseProps}
        error="Fichier trop lourd"
        calendarSuggestion={{ text: 'demain 14h' }}
        showChips={true}
      />
    )
    expect(html).toContain('Fichier trop lourd')
    expect(html).not.toContain('demain 14h')
    expect(html).not.toContain('Résumer')
  })

  it('voix active → masque calendrier et chips (sans erreur)', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot
        {...baseProps}
        isRecordingAudio={true}
        calendarSuggestion={{ text: 'demain 14h' }}
        showChips={true}
      />
    )
    expect(html).toContain('chat.input.voice.recording')
    expect(html).not.toContain('demain 14h')
    expect(html).not.toContain('Résumer')
  })

  it('calendrier prioritaire sur les chips', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot
        {...baseProps}
        calendarSuggestion={{ text: 'demain 14h' }}
        showChips={true}
      />
    )
    expect(html).toContain('demain 14h')
    expect(html).not.toContain('Résumer')
  })

  it('chips seules quand rien d\'autre — en scroll horizontal sans wrap', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} showChips={true} />
    )
    expect(html).toContain('Résumer')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('flex-nowrap')
  })

  it('expose l\'action armée sans afficher son prompt caché', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} showChips={true} activeChipId="summarize" />
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Résumer')
    expect(html).not.toContain('Résume-moi ce texte')
  })

  it('transcript intérimaire visible pendant la dictée', () => {
    const html = renderToStaticMarkup(
      <InputContextSlot {...baseProps} isListening={true} interimTranscript="bonjour je" />
    )
    expect(html).toContain('bonjour je')
  })

  it('bouton de dismiss rendu uniquement quand fourni (erreur enhancer)', () => {
    const withDismiss = renderToStaticMarkup(
      <InputContextSlot {...baseProps} error="Enhancer KO" onDismissError={() => {}} />
    )
    const withoutDismiss = renderToStaticMarkup(
      <InputContextSlot {...baseProps} error="Micro refusé" />
    )
    expect(withDismiss).toContain('common.close')
    expect(withoutDismiss).not.toContain('common.close')
  })

  it('rien à afficher → rendu vide', () => {
    const html = renderToStaticMarkup(<InputContextSlot {...baseProps} />)
    expect(html).toBe('')
  })
})
