import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../i18n'
import { streamMessage, type ToolHandler as ClientToolHandler } from '../services/anthropicClient'
import { TOOLS } from '../services/toolDefinitions'
import { createGmailHandlers } from '../services/tools/gmailTools'
import { createCalendarHandlers } from '../services/tools/calendarTools'
import { listEvents } from '../services/calendarClient'
import { areNotificationsEnabled } from '../services/notificationService'
import { scheduleMorningNotification } from '../services/morningBriefService'
import {
  isProactiveBriefEnabled,
  isBriefDue,
  markBriefRun,
  shouldScheduleNudge,
  markNudgeScheduled,
} from '../services/proactiveBriefSettings'
import type { useGmail } from './useGmail'

// Outils EXCLUSIVEMENT en lecture exposés au modèle pour le brief autonome.
// Sécurité (RÈGLE 6 / lethal trifecta) : le brief ingère du contenu non fiable
// (corps des mails) SANS humain dans la boucle. On retire de l'ensemble tout
// outil d'écriture/envoi/suppression — pas via un prompt "demande
// confirmation" (contournable par injection) mais en ne les rendant jamais
// visibles au modèle. Pas d'outil web non plus : un brief n'en a pas besoin et
// web_fetch serait un canal d'exfiltration pilotable par un mail piégé.
const BRIEF_TOOL_NAMES = ['read_emails', 'read_email', 'search_emails', 'list_calendar']
const BRIEF_TOOL_SET = new Set<string>(BRIEF_TOOL_NAMES)
const BRIEF_TOOLS = TOOLS.filter((t) => BRIEF_TOOL_SET.has((t as { name?: string }).name ?? ''))

interface Params {
  gmail: ReturnType<typeof useGmail>
  isGoogleConnected: boolean
  userName?: string
}

export function useProactiveBrief({ gmail, isGoogleConnected, userName }: Params) {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const runningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const gmailRef = useRef(gmail)
  gmailRef.current = gmail
  const nameRef = useRef(userName)
  nameRef.current = userName

  const runBrief = useCallback(async () => {
    if (runningRef.current) return
    if (!isProactiveBriefEnabled() || !isGoogleConnected) return
    if (!isBriefDue()) return

    runningRef.current = true
    setDismissed(false)
    setLoading(true)
    setBrief(null)

    try {
      // Pré-check GRATUIT (API Google, pas Claude) : sans mail non lu ni
      // événement à venir, aucun token Claude n'est dépensé.
      const [messages, events] = await Promise.all([
        gmailRef.current.fetchMessages().catch(() => []),
        listEvents(2).catch(() => []),
      ])
      markBriefRun()
      // Programme le rappel quotidien (nudge 8h), au plus une fois par jour.
      if (areNotificationsEnabled() && shouldScheduleNudge()) {
        markNudgeScheduled()
        void scheduleMorningNotification(nameRef.current)
      }

      const hasMail = Array.isArray(messages) && messages.length > 0
      const hasEvents = Array.isArray(events) && events.length > 0
      if (!hasMail && !hasEvents) {
        setBrief(i18n.t('proactiveBrief.calm'))
        return
      }

      // Handler lecture-seule : whitelist stricte, tout le reste refusé
      // (défense en profondeur, même si le modèle ne voit que BRIEF_TOOLS).
      const gmailHandlers = createGmailHandlers(gmailRef.current)
      const calendarHandlers = createCalendarHandlers()
      const handlers = {
        read_emails: gmailHandlers.read_emails,
        read_email: gmailHandlers.read_email,
        search_emails: gmailHandlers.search_emails,
        list_calendar: calendarHandlers.list_calendar,
      } as Record<string, (input: Record<string, unknown>) => Promise<{ result: string }>>

      const onToolCall: ClientToolHandler = async (name, input) => {
        if (!BRIEF_TOOL_SET.has(name) || !handlers[name]) {
          return { result: `Outil "${name}" non autorisé en mode brief (lecture seule).` }
        }
        try {
          return await handlers[name](input)
        } catch {
          return { result: `Erreur de lecture (${name}).` }
        }
      }

      let acc = ''
      await new Promise<void>((resolve) => {
        const controller = streamMessage(
          [{ role: 'user', content: i18n.t('proactiveBrief.prompt') }],
          (token) => { acc += token },
          () => resolve(),
          () => resolve(), // erreur → on résout, le finally remet l'UI au propre
          {
            systemPrompt: i18n.t('proactiveBrief.systemPrompt'),
            onToolCall,
            tools: BRIEF_TOOLS,
            model: 'claude-haiku-4-5-20251001',
          },
        )
        abortRef.current = controller
      })

      setBrief(acc.trim() || null)
    } catch {
      setBrief(null)
    } finally {
      setLoading(false)
      runningRef.current = false
    }
  }, [isGoogleConnected])

  // Déclencheurs : à l'ouverture (mount) + à chaque retour au premier plan
  // (appStateChange natif / visibilitychange web). PAS de setInterval : sur
  // WebView Capacitor les timers JS sont gelés quand l'app est minimisée, donc
  // une boucle ne tournerait de toute façon qu'au premier plan.
  useEffect(() => {
    if (!isGoogleConnected) return
    let cancelled = false
    const trigger = () => { if (!cancelled) void runBrief() }

    const mountTimer = setTimeout(trigger, 1800)

    let removeNative: (() => void) | undefined
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) trigger()
        }).then((handle) => {
          if (cancelled) handle.remove()
          else removeNative = () => handle.remove()
        })
      )
      .catch(() => {})

    const onVisible = () => { if (document.visibilityState === 'visible') trigger() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(mountTimer)
      document.removeEventListener('visibilitychange', onVisible)
      removeNative?.()
      // Coupe un brief en vol (ex: switch de compte / unmount) — il est en
      // lecture seule et n'écrit dans aucun store, donc rien à corrompre.
      abortRef.current?.abort()
    }
  }, [isGoogleConnected, runBrief])

  const dismiss = useCallback(() => {
    setDismissed(true)
    abortRef.current?.abort()
  }, [])

  return {
    brief: dismissed ? null : brief,
    loading: dismissed ? false : loading,
    dismiss,
  }
}
