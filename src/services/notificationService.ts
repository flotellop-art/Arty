/**
 * Notification service — local Web Push API (no server needed).
 * Uses the Service Worker to show and schedule notifications.
 */

import * as scoped from './scopedStorage'

const NOTIF_ENABLED_KEY = 'notifications-enabled'

type CalendarEventLike = {
  title: string
  start: string // ISO string or date
  location?: string
}

// Capacitor native detection — on Android APK the browser `Notification` API
// silently returns 'denied' without showing the system dialog. Permission has
// to be requested via the Capacitor LocalNotifications plugin so the OS
// Android 13+ prompt actually appears. We keep the browser path for PWA.
function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor
  return cap?.isNativePlatform?.() === true
}

function isSupported(): boolean {
  if (isNativeApp()) return true // native plugin handles it
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

/** Return true if the user has enabled notifications in settings (and granted permission). */
export function areNotificationsEnabled(): boolean {
  if (!isSupported()) return false
  // On native we optimistically trust the stored toggle — the plugin has
  // its own enabled/disabled state that mirrors the OS permission, which
  // we check at request time. On web we still gate on Notification.permission.
  if (!isNativeApp() && Notification.permission !== 'granted') return false
  const stored = scoped.getItem(NOTIF_ENABLED_KEY)
  // Default: enabled once permission is granted
  return stored === null ? true : stored === 'true'
}

export function setNotificationsEnabled(enabled: boolean): void {
  scoped.setItem(NOTIF_ENABLED_KEY, enabled ? 'true' : 'false')
}

/**
 * Ask the user for notification permission. Returns the final permission state.
 * On Capacitor native, delegates to the LocalNotifications plugin which
 * triggers the Android 13+ POST_NOTIFICATIONS system dialog. On web, uses
 * the browser Notification API.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return 'denied'

  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      // Try checkPermissions first so we don't prompt users who already decided.
      const current = await LocalNotifications.checkPermissions()
      if (current.display === 'granted') return 'granted'
      if (current.display === 'denied') return 'denied'
      const result = await LocalNotifications.requestPermissions()
      return result.display === 'granted' ? 'granted' : 'denied'
    } catch (err) {
      console.warn('[notificationService] native permission request failed:', err)
      return 'denied'
    }
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return 'denied'
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return reg ?? null
  } catch {
    return null
  }
}

/**
 * Schedule a local notification after `delayMs` milliseconds.
 * Uses the SW for background delivery when supported; falls back to setTimeout.
 */
export async function scheduleNotification(
  title: string,
  body: string,
  delayMs: number,
  tag?: string
): Promise<void> {
  if (!areNotificationsEnabled()) return
  if (delayMs <= 0) {
    return showNotification(title, body, tag)
  }

  // Natif (APK) : planifier via le scheduler OS (LocalNotifications). C'est le
  // SEUL chemin fiable pour qu'un rappel futur se déclenche même app fermée.
  // Le setTimeout / Service Worker ne survivent pas à la fermeture (le SW est
  // tué par l'OS après quelques secondes). `at` accepte une date future.
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.schedule({
        notifications: [
          {
            // id doit tenir sur un int32 positif (contrainte Android).
            id: Math.floor(Date.now() % 2_000_000_000),
            title,
            body,
            schedule: { at: new Date(Date.now() + delayMs) },
            smallIcon: 'ic_stat_icon',
          },
        ],
      })
      return
    } catch (err) {
      console.warn('[notificationService] native schedule failed, fallback setTimeout:', err)
      // on retombe sur le setTimeout ci-dessous
    }
  }

  // Web : on tente le Service Worker, sinon setTimeout (best-effort, tab ouvert).
  // Limite connue PWA : aucun des deux ne survit de façon fiable à la fermeture
  // pour un délai long (le SW est tué). Une vraie planification web nécessiterait
  // un push serveur — voir ROADMAP.md (v2).
  const reg = await getRegistration()
  if (reg && reg.active) {
    reg.active.postMessage({ type: 'schedule-notification', title, body, delayMs, tag })
    return
  }
  setTimeout(() => { void showNotification(title, body, tag) }, delayMs)
}

export async function showNotification(title: string, body: string, tag?: string): Promise<void> {
  if (!areNotificationsEnabled()) return
  const reg = await getRegistration()
  if (reg) {
    try {
      await reg.showNotification(title, {
        body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: tag || 'arty-notif',
      })
      return
    } catch {
      // fall through to Notification API
    }
  }
  try {
    new Notification(title, { body, icon: '/icons/icon-192x192.png', tag: tag || 'arty-notif' })
  } catch {
    // Permission revoked or other error — silently ignore
  }
}

/**
 * Fire a notification 15 minutes before a calendar event starts.
 */
export async function notifyCalendarEvent(event: CalendarEventLike): Promise<void> {
  if (!areNotificationsEnabled()) return
  const start = new Date(event.start).getTime()
  if (!Number.isFinite(start)) return
  const delay = start - Date.now() - 15 * 60 * 1000
  if (delay <= 0) return // too late to schedule
  const body = event.location
    ? `Dans 15 min — ${event.title} (${event.location})`
    : `Dans 15 min — ${event.title}`
  await scheduleNotification('📅 Rendez-vous à venir', body, delay, `cal-${event.title}`)
}

/**
 * Fire a notification for an email Claude has marked as urgent/important.
 */
export async function notifyImportantEmail(subject: string, sender: string): Promise<void> {
  if (!areNotificationsEnabled()) return
  await showNotification(
    `📧 ${sender}`,
    subject || '(sans objet)',
    `email-${subject}`
  )
}
