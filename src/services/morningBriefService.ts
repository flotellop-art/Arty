/**
 * Morning Brief Service
 * Gère le brief quotidien du matin : vérification, données, notification planifiée.
 */

const BRIEF_SHOWN_KEY = 'arty-morning-brief-shown'

/** Retourne true si on est entre 6h et 11h et que le brief n'a pas encore été montré aujourd'hui */
export function shouldShowMorningBrief(): boolean {
  const hour = new Date().getHours()
  if (hour < 6 || hour >= 11) return false

  const today = new Date().toDateString()
  const lastShown = localStorage.getItem(BRIEF_SHOWN_KEY)
  return lastShown !== today
}

/** Marque le brief comme montré aujourd'hui */
export function markBriefShown(): void {
  localStorage.setItem(BRIEF_SHOWN_KEY, new Date().toDateString())
}

/** Planifie la notification de demain matin à 8h00 */
export async function scheduleMorningNotification(userName?: string): Promise<void> {
  try {
    const { scheduleNotification, areNotificationsEnabled } = await import('./notificationService')
    if (!areNotificationsEnabled()) return

    const now = new Date()
    const tomorrow8h = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      8, 0, 0, 0
    )
    const delayMs = tomorrow8h.getTime() - now.getTime()

    const greeting = userName ? `Bonjour ${userName.split(' ')[0]} 👋` : 'Bonjour 👋'
    await scheduleNotification(
      greeting,
      'Votre brief du matin est prêt — agenda, emails, et plus.',
      delayMs,
      'morning-brief'
    )
  } catch {
    // Non-fatal
  }
}

/** Salutation en fonction de l'heure */
export function getGreeting(name?: string): string {
  const hour = new Date().getHours()
  const firstName = name?.split(' ')[0] || ''
  const suffix = firstName ? `, ${firstName}` : ''

  if (hour < 12) return `Bonjour${suffix} 👋`
  if (hour < 18) return `Bon après-midi${suffix}`
  return `Bonsoir${suffix}`
}

/** Formate une date ISO en heure lisible */
export function formatEventTime(isoStart: string): string {
  try {
    const d = new Date(isoStart)
    if (isNaN(d.getTime())) return ''
    // All-day events have no time component
    if (!isoStart.includes('T')) return 'Toute la journée'
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
