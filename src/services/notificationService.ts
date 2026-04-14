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

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

/** Return true if the user has enabled notifications in settings (and granted permission). */
export function areNotificationsEnabled(): boolean {
  if (!isSupported()) return false
  if (Notification.permission !== 'granted') return false
  const stored = scoped.getItem(NOTIF_ENABLED_KEY)
  // Default: enabled once permission is granted
  return stored === null ? true : stored === 'true'
}

export function setNotificationsEnabled(enabled: boolean): void {
  scoped.setItem(NOTIF_ENABLED_KEY, enabled ? 'true' : 'false')
}

/**
 * Ask the user for notification permission. Returns the final permission state.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return 'denied'
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

  const reg = await getRegistration()
  if (reg && reg.active) {
    reg.active.postMessage({ type: 'schedule-notification', title, body, delayMs, tag })
    return
  }

  // Fallback: setTimeout (only fires while the tab is open)
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
