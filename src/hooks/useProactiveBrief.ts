import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../i18n'
import { streamMessage, type ToolHandler as ClientToolHandler } from '../services/anthropicClient'
import { TOOLS } from '../services/toolDefinitions'
import { createGmailHandlers } from '../services/tools/gmailTools'
import { createCalendarHandlers } from '../services/tools/calendarTools'
import type { ToolHandler } from '../services/tools/types'
import { listEvents } from '../services/calendarClient'
import { areNotificationsEnabled } from '../services/notificationService'
import { scheduleMorningNotification } from '../services/morningBriefService'
import { getTasks, addTask } from '../services/taskService'
import { getTrialRemaining } from '../services/trialClient'
import { readAllMemory, formatMemoryForPrompt } from '../services/memoryService'
import {
  isProactiveBriefEnabled,
  isBriefDue,
  markBriefRun,
  shouldScheduleNudge,
  markNudgeScheduled,
  getBriefPrefs,
} from '../services/proactiveBriefSettings'
import {
  PRESENT_BRIEF_TOOL,
  sanitizeBriefData,
  routeBriefAction,
  type BriefData,
  type BriefItem,
  type BriefAction,
} from '../services/proactiveBriefActions'
import type { useGmail } from './useGmail'

// Outils EXCLUSIVEMENT en lecture exposés au modèle, + l'outil de sortie
// structurée. Sécurité (RÈGLE 6 / lethal trifecta) : le brief ingère du contenu
// non fiable (mails) ET de la mémoire privée, sans humain dans la boucle. Aucun
// outil d'écriture/envoi/suppression, AUCUN outil web (web_fetch = exfiltration).
const READ_TOOL_NAMES = ['read_emails', 'read_email', 'search_emails', 'list_calendar']
const READ_TOOL_SET = new Set<string>(READ_TOOL_NAMES)
const BRIEF_TOOLS = [
  ...TOOLS.filter((t) => READ_TOOL_SET.has((t as { name?: string }).name ?? '')),
  PRESENT_BRIEF_TOOL,
] as typeof TOOLS

// Plafond de lectures détaillées par brief : empêche le modèle de lire 10 corps
// de mails complets chaque matin (coût + surface). 3 suffit pour un brief.
const MAX_READ_EMAIL = 3

type BriefState = { items: BriefItem[] } | { text: string } | null

interface Params {
  gmail: ReturnType<typeof useGmail>
  isGoogleConnected: boolean
  userName?: string
  onSend: (text: string) => void
}

export function useProactiveBrief({ gmail, isGoogleConnected, userName, onSend }: Params) {
  const [brief, setBrief] = useState<BriefState>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const runningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const gmailRef = useRef(gmail)
  gmailRef.current = gmail
  const nameRef = useRef(userName)
  nameRef.current = userName
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend

  const runBrief = useCallback(async () => {
    if (runningRef.current) return
    if (!isProactiveBriefEnabled() || !isGoogleConnected) return
    // Ne PAS dépenser le quota d'essai (limité, 30 msgs) pour un brief auto que
    // l'utilisateur n'a pas demandé : ça grillait 1 message/jour à chaque
    // connexion (bug remonté). Le brief reste actif pour les plans payants. On
    // détecte le trial de façon synchrone via le compteur trial mis en cache
    // (`getTrialRemaining`) OU le plan caché par usePlanStatus — deux signaux
    // qui ne valent JAMAIS "trial" par défaut, donc aucun faux blocage des payants.
    let cachedPlan: string | null = null
    try { cachedPlan = localStorage.getItem('arty-plan-cache') } catch { /* noop */ }
    if (getTrialRemaining() !== null || cachedPlan === 'trial') return
    if (!isBriefDue()) return

    runningRef.current = true
    setDismissed(false)
    setLoading(true)
    // On NE vide PAS `brief` : si une carte est déjà affichée (ex: refresh au
    // retour dans l'app), elle reste lisible jusqu'à ce que la nouvelle soit prête.

    try {
      // Pré-check GRATUIT (API Google, pas Claude) : sans mail non lu ni
      // événement à venir, aucun token Claude n'est dépensé.
      const [messages, events] = await Promise.all([
        gmailRef.current.fetchMessages().catch(() => []),
        listEvents(2).catch(() => []),
      ])
      markBriefRun()
      if (areNotificationsEnabled() && shouldScheduleNudge()) {
        markNudgeScheduled()
        void scheduleMorningNotification(nameRef.current)
      }

      const hasMail = Array.isArray(messages) && messages.length > 0
      const hasEvents = Array.isArray(events) && events.length > 0
      if (!hasMail && !hasEvents) {
        setBrief({ text: i18n.t('proactiveBrief.calm') })
        return
      }

      // Contexte additionnel (sources étendues), gardé COMPACT pour le coût.
      let extra = ''
      const tasks = getTasks().filter((t) => !t.done).slice(0, 10).map((t) => `- ${t.text}`)
      if (tasks.length) extra += `\n\nTÂCHES EN COURS (Arty) :\n${tasks.join('\n')}`
      try {
        const mem = await readAllMemory()
        // mode conditionnel minimal (Tier 0) via un userMessage neutre, puis tronqué.
        const memStr = formatMemoryForPrompt(mem, ' ').slice(0, 600)
        if (memStr.trim()) extra += `\n${memStr}`
      } catch { /* mémoire indisponible — non bloquant */ }

      const prefs = getBriefPrefs()
      const lenDirective = prefs.length === 'short'
        ? '\n\nL\'utilisateur préfère un brief TRÈS court : 3 éléments maximum, l\'essentiel seulement.'
        : ''
      const systemPrompt = i18n.t('proactiveBrief.systemPrompt') + extra + lenDirective

      // Handler lecture-seule + capture de la sortie structurée. Tout outil hors
      // whitelist est refusé (défense en profondeur, même si le modèle ne voit
      // que BRIEF_TOOLS). read_email plafonné.
      const gmailHandlers = createGmailHandlers(gmailRef.current)
      const calendarHandlers = createCalendarHandlers()
      const readHandlers: Record<string, ToolHandler | undefined> = {
        read_emails: gmailHandlers.read_emails,
        read_email: gmailHandlers.read_email,
        search_emails: gmailHandlers.search_emails,
        list_calendar: calendarHandlers.list_calendar,
      }
      let readEmailCount = 0
      const captured: { data: BriefData | null } = { data: null }

      const onToolCall: ClientToolHandler = async (name, input) => {
        if (name === 'present_brief') {
          if (!captured.data) captured.data = sanitizeBriefData(input)
          return { result: 'Brief enregistré. Termine maintenant sans autre action.' }
        }
        if (name === 'read_email' && readEmailCount >= MAX_READ_EMAIL) {
          return { result: 'Limite de lecture détaillée atteinte pour le brief — synthétise avec ce que tu as.' }
        }
        const handler = readHandlers[name]
        if (!handler) return { result: `Outil "${name}" non autorisé en mode brief (lecture seule).` }
        if (name === 'read_email') readEmailCount++
        try { return await handler(input) } catch { return { result: `Erreur de lecture (${name}).` } }
      }

      let acc = ''
      await new Promise<void>((resolve) => {
        const controller = streamMessage(
          [{ role: 'user', content: i18n.t('proactiveBrief.prompt') }],
          (token) => { acc += token },
          () => resolve(),
          () => resolve(), // erreur → on résout, le fallback gère l'affichage
          {
            systemPrompt,
            onToolCall,
            tools: BRIEF_TOOLS,
            model: 'claude-haiku-4-5-20251001',
          },
        )
        abortRef.current = controller
      })

      // Sortie structurée si capturée, sinon fallback sur le texte streamé
      // (jamais de carte vide), sinon message "calme".
      if (captured.data && captured.data.items.length) setBrief({ items: captured.data.items })
      else if (acc.trim()) setBrief({ text: acc.trim() })
      else setBrief({ text: i18n.t('proactiveBrief.calm') })
    } catch {
      // On garde une éventuelle carte déjà affichée plutôt que de la vider.
    } finally {
      setLoading(false)
      runningRef.current = false
    }
  }, [isGoogleConnected])

  // Déclencheurs : ouverture (mount) + retour au premier plan (appStateChange
  // natif / visibilitychange web). PAS de setInterval (timers gelés en arrière-plan).
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
      abortRef.current?.abort()
    }
  }, [isGoogleConnected, runBrief])

  const dismiss = useCallback(() => {
    setDismissed(true)
    abortRef.current?.abort()
  }, [])

  // Exécute une action de chip. Le routage est construit côté client (jamais par
  // le modèle) : reminder = tâche locale ; le reste passe par le chat (humain
  // dans la boucle), routé par message_id validé.
  const runAction = useCallback((action: BriefAction, item: BriefItem): 'task' | 'chat' | null => {
    const route = routeBriefAction(action, item)
    if (!route) return null
    if (route.kind === 'task') {
      addTask(route.text)
      return 'task'
    }
    onSendRef.current(route.prompt)
    return 'chat'
  }, [])

  return {
    brief: dismissed ? null : brief,
    loading: dismissed ? false : loading,
    dismiss,
    runAction,
  }
}
