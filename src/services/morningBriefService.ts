import i18n from '../i18n'
import { getDateLocale } from '../utils/formatDate'
import { listEvents } from './calendarClient'
import { listUnreadEmails } from './gmailClient'
import { getUserLocation, isLocationConsentEnabled } from './native/location'
import { apiUrl } from './apiBase'
import { safeJson } from '../utils/safeJson'
import { getValidAccessToken } from './googleAuth'

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

    const firstName = userName ? userName.split(' ')[0] : ''
    const greeting = i18n.t('morningBrief.notificationTitle', { name: firstName ? ` ${firstName}` : '' })
    await scheduleNotification(
      greeting,
      i18n.t('morningBrief.notificationBody'),
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

  if (hour < 12) return `${i18n.t('home.greetingMorning')}${suffix} 👋`
  if (hour < 18) return `${i18n.t('home.greetingAfternoon')}${suffix}`
  return `${i18n.t('home.greetingEvening')}${suffix}`
}

/** Formate une date ISO en heure lisible */
export function formatEventTime(isoStart: string): string {
  try {
    const d = new Date(isoStart)
    if (isNaN(d.getTime())) return ''
    // All-day events have no time component
    if (!isoStart.includes('T')) return i18n.t('morningBrief.allDay')
    return d.toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Construit le texte brut du brief pour la synthèse vocale.
 * Combine la salutation, la date, la météo (si position consentie), l'agenda et les emails non lus.
 */
export async function buildBriefSpeechText(
  userName?: string,
  isGoogleConnected?: boolean
): Promise<string> {
  // 1. Salutation (sans emoji)
  const hour = new Date().getHours()
  const firstName = userName?.split(' ')[0] || ''
  const suffix = firstName ? `, ${firstName}` : ''
  let greeting = ''
  if (hour < 12) {
    greeting = `${i18n.t('home.greetingMorning')}${suffix}.`
  } else if (hour < 18) {
    greeting = `${i18n.t('home.greetingAfternoon')}${suffix}.`
  } else {
    greeting = `${i18n.t('home.greetingEvening')}${suffix}.`
  }

  // 2. Date du jour
  const todayStr = new Date().toLocaleDateString(getDateLocale(), {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const dateSpeech = i18n.t('morningBrief.speech.todayIs', { date: todayStr })

  // 3. Météo
  let weatherSpeech = ''
  if (isGoogleConnected && isLocationConsentEnabled()) {
    try {
      const pos = await getUserLocation()
      if (pos) {
        const googleToken = await getValidAccessToken()
        if (!googleToken) throw new Error('Google authentication required for weather')
        const city = `${pos.latitude.toFixed(5)},${pos.longitude.toFixed(5)}`
        const res = await fetch(apiUrl('/api/browser/weather'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-google-token': googleToken },
          body: JSON.stringify({ city }),
        })
        if (res.ok) {
          const data = await safeJson(res)
          if (data && data.current) {
            weatherSpeech = i18n.t('morningBrief.speech.weather', {
              city: data.city || '',
              condition: data.current.condition,
              temp: Math.round(data.current.temperature),
            })
          }
        }
      }
    } catch (e) {
      console.warn('Speech weather fetch error:', e)
    }
  }

  // 4. Agenda
  let calendarSpeech = ''
  if (isGoogleConnected) {
    try {
      const events = await listEvents(1)
      if (events.length === 0) {
        calendarSpeech = i18n.t('morningBrief.speech.noEvents')
      } else {
        const eventsList = events.map(e => {
          const time = formatEventTime(e.start)
          const timePrefix = time === i18n.t('morningBrief.allDay')
            ? i18n.t('morningBrief.speech.allDayPrefix')
            : i18n.t('morningBrief.speech.atTimePrefix', { time })
          return `${timePrefix}, ${e.title}`
        }).join('. ')
        calendarSpeech = i18n.t('morningBrief.speech.eventsIntro', {
          count: events.length,
          eventsList,
        })
      }
    } catch (e) {
      console.warn('Speech calendar fetch error:', e)
    }
  }

  // 5. Emails non lus
  let emailSpeech = ''
  if (isGoogleConnected) {
    try {
      const emails = await listUnreadEmails()
      if (emails.length === 0) {
        emailSpeech = i18n.t('morningBrief.speech.noEmails')
      } else {
        const cleanSender = (fromStr: string): string => {
          let name = (fromStr.split('<')[0] || '').trim()
          if (!name && fromStr.includes('@')) {
            name = (fromStr.split('@')[0] || '').trim()
          }
          name = name.replace(/^"+|"+$/g, '')
          return name || fromStr
        }
        const uniqueSenders = Array.from(new Set(emails.map(e => cleanSender(e.from)))).slice(0, 5)
        const sendersList = uniqueSenders.join(', ')
        emailSpeech = i18n.t(
          emails.length === 1 ? 'morningBrief.speech.emailsIntro_one' : 'morningBrief.speech.emailsIntro_other',
          { count: emails.length, senders: sendersList }
        )
      }
    } catch (e) {
      console.warn('Speech email fetch error:', e)
    }
  }

  const speechParts = [greeting, dateSpeech]
  if (weatherSpeech) speechParts.push(weatherSpeech)
  if (calendarSpeech) speechParts.push(calendarSpeech)
  if (emailSpeech) speechParts.push(emailSpeech)

  return speechParts.filter(Boolean).join(' ')
}

