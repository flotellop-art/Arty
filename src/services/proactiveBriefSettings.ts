import * as scoped from './scopedStorage'

const ENABLED_KEY = 'proactive-brief-enabled'
const LAST_RUN_KEY = 'proactive-brief-last-run'
const NUDGE_DAY_KEY = 'proactive-brief-nudge-day'

// Délai minimum entre deux briefs auto (ms). Le brief se déclenche à
// l'ouverture ET à chaque retour au premier plan ; sans ce garde-fou, chaque
// va-et-vient relancerait un appel Claude. 3h borne la dépense : au pire un
// brief par fenêtre, même sur dix ouvertures d'affilée.
export const BRIEF_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000

/** Brief proactif actif ? Activé par défaut, désactivable dans les Paramètres. */
export function isProactiveBriefEnabled(): boolean {
  const stored = scoped.getItem(ENABLED_KEY)
  return stored === null ? true : stored === 'true'
}

export function setProactiveBriefEnabled(enabled: boolean): void {
  scoped.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
}

/** True si assez de temps s'est écoulé depuis le dernier brief auto. */
export function isBriefDue(now = Date.now()): boolean {
  const raw = scoped.getItem(LAST_RUN_KEY)
  if (!raw) return true
  const last = Number(raw)
  if (!Number.isFinite(last)) return true
  if (now - last >= BRIEF_MIN_INTERVAL_MS) return true
  // Nouveau jour calendaire depuis le dernier brief → brief frais du matin,
  // même si moins de 3h se sont écoulées (cas: dernier brief tard hier soir).
  if (new Date(last).toDateString() !== new Date(now).toDateString()) return true
  return false
}

export function markBriefRun(now = Date.now()): void {
  scoped.setItem(LAST_RUN_KEY, String(now))
}

// Le rappel quotidien (nudge 8h) ne doit être programmé qu'une fois par jour :
// le brief peut tourner plusieurs fois (chaque retour au premier plan), sans ce
// garde-fou on empilerait des timers SW (cf. esprit BUG 46).
export function shouldScheduleNudge(now = new Date()): boolean {
  return scoped.getItem(NUDGE_DAY_KEY) !== now.toDateString()
}

export function markNudgeScheduled(now = new Date()): void {
  scoped.setItem(NUDGE_DAY_KEY, now.toDateString())
}

// Préférences ajustées par le feedback pouce haut/bas. On reste sur des
// DIRECTIVES concrètes (longueur) plutôt qu'un signal vague — c'est ce qui
// change vraiment la sortie. Faible sensibilité (pas de PII) → setJSON clair.
const PREFS_KEY = 'proactive-brief-prefs'

export interface BriefPrefs {
  length: 'normal' | 'short'
  signal: number
}

export function getBriefPrefs(): BriefPrefs {
  const p = scoped.getJSON<BriefPrefs>(PREFS_KEY)
  if (!p || (p.length !== 'short' && p.length !== 'normal')) return { length: 'normal', signal: 0 }
  return { length: p.length, signal: Number.isFinite(p.signal) ? p.signal : 0 }
}

/** Pouce bas → vers "court" ; pouce haut → vers "normal". Seuil pour éviter
 *  qu'un seul clic ne bascule tout. */
export function recordBriefFeedback(positive: boolean): BriefPrefs {
  const prev = getBriefPrefs()
  let signal = prev.signal + (positive ? 1 : -1)
  signal = Math.max(-3, Math.min(3, signal))
  const length: BriefPrefs['length'] = signal <= -2 ? 'short' : 'normal'
  const next: BriefPrefs = { length, signal }
  scoped.setJSON(PREFS_KEY, next)
  return next
}
