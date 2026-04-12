import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from './platform'

/**
 * Request push notification permissions and register for push.
 * Returns the device token for server-side push.
 */
export async function initPushNotifications(): Promise<string | null> {
  if (!isNative) return null

  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') {
      console.warn('Push notifications permission denied')
      return null
    }

    await PushNotifications.register()

    return new Promise((resolve) => {
      PushNotifications.addListener('registration', (token) => {
        // token.value intentionally not logged for security
        resolve(token.value)
      })

      PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration error:', err)
        resolve(null)
      })
    })
  } catch (err) {
    console.warn('initPushNotifications failed:', err)
    return null
  }
}

/**
 * Listen for incoming push notifications.
 */
export function onPushNotification(callback: (title: string, body: string, data: Record<string, unknown>) => void) {
  if (!isNative) return

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    callback(
      notification.title || '',
      notification.body || '',
      notification.data || {}
    )
  })

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    callback(
      action.notification.title || '',
      action.notification.body || '',
      action.notification.data || {}
    )
  })
}

/**
 * Send a local notification (e.g. "Devis envoyé", "Email reçu").
 */
export async function sendLocalNotification(title: string, body: string, id?: number): Promise<void> {
  if (!isNative) {
    // Web fallback: use browser Notification API
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
    return
  }

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: id || Date.now(),
          title,
          body,
          schedule: { at: new Date(Date.now() + 100) },
          sound: undefined,
          smallIcon: 'ic_stat_icon',
        },
      ],
    })
  } catch (err) {
    console.warn('sendLocalNotification failed:', err)
  }
}

/**
 * Request local notification permissions.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission()
      return perm === 'granted'
    }
    return false
  }

  try {
    const perm = await LocalNotifications.requestPermissions()
    return perm.display === 'granted'
  } catch {
    return false
  }
}
