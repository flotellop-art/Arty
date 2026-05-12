/**
 * Text-to-Speech helper (roadmap Phase 2 A — mode voix bidirectionnel).
 *
 * Utilise la Web Speech API native (SpeechSynthesisUtterance) qui marche sur :
 * - Web : Chrome, Firefox, Safari (desktop + mobile)
 * - Capacitor WebView : Android (TTS Engine natif) et iOS (AVSpeechSynthesizer)
 *
 * Pas besoin d'un plugin Capacitor dédié pour ce premier jet. L'API web
 * délègue déjà au TTS natif de l'OS sur les WebViews.
 *
 * Limitations connues :
 * - Pause/reprise pas fiables sur iOS Safari → on n'utilise que start/cancel.
 * - Latence de chargement de voix au premier appel (1-2s) — surtout iOS.
 * - Sur Chrome desktop, certaines voix tournent dans le cloud Google (lag réseau).
 */

import i18n from '../i18n'

let currentUtterance: SpeechSynthesisUtterance | null = null
let speakingId: string | null = null
const listeners = new Set<(speakingId: string | null) => void>()

function notify(): void {
  for (const fn of listeners) fn(speakingId)
}

/**
 * Locale BCP-47 pour la synthèse. Suit la langue i18next courante.
 */
function getSpeechLocale(): string {
  const lng = (i18n.language || 'fr').slice(0, 2)
  return lng === 'en' ? 'en-US' : 'fr-FR'
}

/**
 * Strip markdown courant pour que la synthèse vocale ne lise pas "astérisque
 * astérisque" sur les **gras**. On ne fait pas un rendu HTML complet — juste
 * un nettoyage minimal des marqueurs syntaxiques qui pollueraient la lecture.
 */
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // blocs de code
    .replace(/`([^`]+)`/g, '$1')      // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // gras
    .replace(/\*([^*]+)\*/g, '$1')     // italique
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')     // strikethrough
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [texte](url) → texte
    .replace(/^#+\s+/gm, '')            // headings
    .replace(/^>\s+/gm, '')             // blockquotes
    .replace(/\n{2,}/g, '. ')           // doubles sauts → pause
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Lance la lecture vocale d'un texte. Si une autre lecture est en cours,
 * elle est annulée d'abord. Idempotent : appeler `speak(text, id)` avec le
 * même `id` que la lecture en cours ne relance pas.
 */
export function speak(text: string, id: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  if (speakingId === id) return // déjà en cours

  // Annule toute lecture en cours
  cancel()

  const cleaned = cleanForSpeech(text)
  if (!cleaned) return

  const utter = new SpeechSynthesisUtterance(cleaned)
  utter.lang = getSpeechLocale()
  utter.rate = 1.0
  utter.pitch = 1.0
  utter.volume = 1.0

  utter.onend = () => {
    if (currentUtterance === utter) {
      currentUtterance = null
      speakingId = null
      notify()
    }
  }
  utter.onerror = utter.onend

  currentUtterance = utter
  speakingId = id
  window.speechSynthesis.speak(utter)
  notify()
}

/**
 * Annule toute lecture en cours. Silencieux sur les plateformes sans TTS.
 */
export function cancel(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  currentUtterance = null
  if (speakingId !== null) {
    speakingId = null
    notify()
  }
}

/**
 * Retourne l'id du message actuellement lu, ou null. Utilisé par les
 * AssistantBubble pour afficher l'état (icône speaker vs stop).
 */
export function getSpeakingId(): string | null {
  return speakingId
}

/**
 * Subscribe à un changement d'état (lecture commencée / terminée).
 * Returns un unsubscribe.
 */
export function onSpeakingChange(fn: (speakingId: string | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Indique si le TTS est disponible. False sur SSR, iOS lockdown mode, etc.
 */
export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}
