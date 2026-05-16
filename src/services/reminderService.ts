import { getDateLocale } from '../utils/formatDate'

/**
 * Reminder service (roadmap Phase 2 C — tâches planifiées par prompt).
 *
 * Détecte les intents "rappelle-moi mardi à 9h de répondre à Marie" dans
 * un message utilisateur et crée :
 * - une tâche dans le TaskPanel existant (via addTask)
 * - une notification locale planifiée à la bonne date (via
 *   scheduleNotification)
 *
 * On NE remplace PAS l'envoi au LLM : si la requête est ambiguë (pas de
 * date claire, pas de texte de rappel après "de"), on laisse passer au LLM
 * pour qu'il gère naturellement. La détection est conservative — mieux
 * vaut rater un cas que d'intercepter à tort une question légitime sur
 * les rappels.
 */

import { addTask } from './taskService'
import { scheduleNotification } from './notificationService'
import { detectDates } from '../utils/dateDetector'

export interface ReminderIntent {
  /** Texte du rappel (ce qu'on doit faire). */
  body: string
  /** Date/heure cible. */
  date: Date
}

/**
 * Triggers FR + EN qui ouvrent une intention de rappel. Conservative :
 * on cherche le verbe explicite ("rappelle-moi", "remind me"), pas juste
 * "rappel" tout court (qui peut être un nom dans n'importe quel contexte
 * type "j'ai un rappel à 14h").
 *
 * À enrichir au fil des cas qui échouent — pattern documenté en BUG 56.
 */
const REMINDER_TRIGGERS = /\b(rappelle[- ]moi|rappelle[ -]?moi|remind\s+me)\b/i

/**
 * Sépare le texte AVANT/APRÈS le trigger pour extraire le body du rappel.
 * "rappelle-moi vendredi à 14h de répondre à Marie"
 *   → trigger = "rappelle-moi"
 *   → body raw = "vendredi à 14h de répondre à Marie"
 *   → on enlève la partie date pour ne garder que "répondre à Marie"
 *
 * "rappelle-moi de payer la facture demain"
 *   → body raw = "de payer la facture demain"
 *   → on enlève "demain" → "payer la facture"
 *   → on enlève le "de" initial → "payer la facture"
 */
function extractBody(rawAfterTrigger: string, matchedDateText: string): string {
  let body = rawAfterTrigger
  // Retire la date trouvée
  if (matchedDateText) {
    body = body.replace(matchedDateText, ' ')
  }
  // Retire les particules de liaison fréquentes
  body = body
    .replace(/^\s*[àa]\s+/, ' ')
    .replace(/^\s*de\s+/, ' ')
    .replace(/^\s*pour\s+/, ' ')
    .replace(/^\s*to\s+/, ' ')
    .replace(/^\s*that\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Capitalise pour la notification (Sentence case)
  if (body.length > 0) body = body[0]!.toUpperCase() + body.slice(1)
  return body
}

/**
 * Détecte un intent de rappel dans un message utilisateur. Retourne null
 * si pas de trigger explicite OU pas de date claire OU pas de texte body.
 */
export function detectReminderIntent(text: string): ReminderIntent | null {
  if (!text) return null
  const triggerMatch = text.match(REMINDER_TRIGGERS)
  if (!triggerMatch) return null

  // Cherche la date dans le message entier (le détecteur sait gérer les
  // formes "demain", "vendredi", "vendredi 14h", "le 12 mai à 9h", etc.).
  const detected = detectDates(text)
  if (!detected) return null

  // Extrait le body (ce qu'on doit faire) — partie après le trigger.
  const triggerIdx = (triggerMatch.index ?? 0) + triggerMatch[0].length
  const afterTrigger = text.slice(triggerIdx)
  const body = extractBody(afterTrigger, detected.match || '')
  if (!body || body.length < 2) return null

  return { body, date: detected.date }
}

/**
 * Crée le rappel : tâche + notification planifiée. Renvoie un libellé
 * humain prêt à être affiché dans un message d'assistant ("✅ Rappel créé
 * pour ...").
 */
export async function createReminder(
  intent: ReminderIntent,
  conversationId: string | null = null
): Promise<string> {
  addTask(intent.body, conversationId)
  const delayMs = intent.date.getTime() - Date.now()
  if (delayMs > 0) {
    // Best-effort : si les notifications ne sont pas autorisées, la tâche
    // reste créée — l'utilisateur la verra dans le TaskPanel. On ne fait
    // pas remonter d'erreur car la création n'est pas un échec.
    await scheduleNotification(
      `⏰ Rappel`,
      intent.body,
      delayMs,
      `reminder-${Date.now()}`
    ).catch(() => {})
  }
  return formatReminderLabel(intent)
}

function formatReminderLabel(intent: ReminderIntent): string {
  const d = intent.date
  const fmt = new Intl.DateTimeFormat(getDateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `✅ Rappel créé : « ${intent.body} » — ${fmt.format(d)}.`
}
