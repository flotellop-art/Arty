import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../i18n'
import { streamMessage, type ToolHandler as ClientToolHandler } from '../services/anthropicClient'
import { TOOLS } from '../services/toolDefinitions'
import { createCalendarHandlers } from '../services/tools/calendarTools'
import type { ToolHandler } from '../services/tools/types'
import { captureCalendarContext, listEvents, type CalendarContext } from '../services/calendarClient'
import { areNotificationsEnabled } from '../services/notificationService'
import { scheduleMorningNotification } from '../services/morningBriefService'
import { getTasks, addTask } from '../services/taskService'
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

// Outil EXCLUSIVEMENT en lecture exposé au modèle, + l'outil de sortie
// structurée. Le brief utilise l'agenda, les tâches et la mémoire locale ;
// aucun outil d'écriture ni outil web n'est disponible en arrière-plan.
const READ_TOOL_NAMES = ['list_calendar']
const READ_TOOL_SET = new Set<string>(READ_TOOL_NAMES)
const BRIEF_TOOLS = [
  ...TOOLS.filter((t) => READ_TOOL_SET.has((t as { name?: string }).name ?? '')),
  PRESENT_BRIEF_TOOL,
] as typeof TOOLS

type BriefState = { items: BriefItem[] } | { text: string } | null

interface Params {
  isGoogleConnected: boolean
  userName?: string
  onSend: (text: string) => void
}

export function useProactiveBrief({ isGoogleConnected, userName, onSend }: Params) {
  const [brief, setBrief] = useState<BriefState>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const runningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const calendarAbortRef = useRef<AbortController | null>(null)
  const calendarScopeRef = useRef<CalendarContext | null>(null)
  const itemScopes = useRef(new WeakMap<BriefItem, CalendarContext>())
  const alive = useRef(true)
  const nameRef = useRef(userName)
  nameRef.current = userName
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend

  const runBrief = useCallback(async () => {
    if (runningRef.current) return
    // isProactiveBriefEnabled() porte le défaut dépendant du plan (OFF pour
    // essai/free, ON pour les payants) + le choix explicite du toggle Paramètres.
    if (!isProactiveBriefEnabled() || !isGoogleConnected) return
    if (!isBriefDue()) return

    runningRef.current = true
    setDismissed(false)
    setLoading(true)
    const calendarController = new AbortController()
    calendarAbortRef.current = calendarController
    const calendarScope = captureCalendarContext(calendarController.signal)
    const cardScope = captureCalendarContext() // same initial grant, independent of Hide/Stop calculation signal
    calendarScopeRef.current = cardScope
    // On NE vide PAS `brief` : si une carte est déjà affichée (ex: refresh au
    // retour dans l'app), elle reste lisible jusqu'à ce que la nouvelle soit prête.

    try {
      // Pré-check gratuit : agenda, tâches et mémoire locale sont inspectés
      // avant de décider si un appel IA est utile.
      const events = await listEvents(2, calendarScope)
      calendarScope!.assertCurrent()
      const tasks = getTasks().filter((t) => !t.done).slice(0, 10).map((t) => `- ${t.text}`)
      let memoryContext = ''
      try {
        const mem = await readAllMemory()
        memoryContext = formatMemoryForPrompt(mem, ' ').slice(0, 600).trim()
      } catch { /* mémoire indisponible — non bloquant */ }
      calendarScope!.assertCurrent()
      markBriefRun()
      if (areNotificationsEnabled() && shouldScheduleNudge()) {
        markNudgeScheduled()
        void scheduleMorningNotification(nameRef.current)
      }

      const hasUsefulContext = (Array.isArray(events) && events.length > 0)
        || tasks.length > 0
        || memoryContext.length > 0
      if (!hasUsefulContext) {
        setBrief({ text: i18n.t('proactiveBrief.calm') })
        return
      }

      // Contexte additionnel (sources étendues), gardé COMPACT pour le coût.
      let extra = ''
      if (tasks.length) extra += `\n\nTÂCHES EN COURS (Arty) :\n${tasks.join('\n')}`
      if (memoryContext) extra += `\n${memoryContext}`

      const prefs = getBriefPrefs()
      const lenDirective = prefs.length === 'short'
        ? '\n\nL\'utilisateur préfère un brief TRÈS court : 3 éléments maximum, l\'essentiel seulement.'
        : ''
      const systemPrompt = i18n.t('proactiveBrief.systemPrompt') + extra + lenDirective

      // Handler lecture-seule + capture de la sortie structurée. Tout outil hors
      // whitelist est refusé, même si le modèle ne voit que BRIEF_TOOLS.
      const calendarHandlers = createCalendarHandlers()
      const readHandlers: Record<string, ToolHandler | undefined> = {
        list_calendar: calendarHandlers.list_calendar,
      }
      const captured: { data: BriefData | null } = { data: null }

      const onToolCall: ClientToolHandler = async (name, input) => {
        calendarScope!.assertCurrent()
        if (name === 'present_brief') {
          if (!captured.data) captured.data = sanitizeBriefData(input)
          return { result: 'Brief enregistré. Termine maintenant sans autre action.' }
        }
        const handler = readHandlers[name]
        if (!handler) return { result: `Outil "${name}" non autorisé en mode brief (lecture seule).` }
        try { return await handler(input, { calendar: { scope: calendarScope, signal: calendarController.signal } }) } catch { return { result: `Erreur de lecture (${name}).` } }
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
            // F-4 (audit visibilité modèle) — appel de fond : ne doit JAMAIS
            // écraser le badge « Dernier appel » de la conversation affichée
            // (le brief se déclenche au retour foreground, en pleine
            // conversation — le badge passait à Haiku 🇺🇸 sans message envoyé).
            background: true,
            assertRequestCurrent: () => calendarScope!.assertCurrent(),
            beforeDocumentRequest: () => calendarScope!.validateReadOnly(),
          },
        )
        abortRef.current = controller
      })

      // Sortie structurée si capturée, sinon fallback sur le texte streamé
      calendarScope!.assertCurrent()
      // (jamais de carte vide), sinon message "calme".
      if (captured.data && captured.data.items.length) {
        cardScope!.assertCurrent()
        for (const item of captured.data.items) itemScopes.current.set(item, cardScope!)
        setBrief({ items: captured.data.items })
      }
      else if (acc.trim()) setBrief({ text: acc.trim() })
      else setBrief({ text: i18n.t('proactiveBrief.calm') })
    } catch {
      // Unavailable is not an empty/calm agenda. Never retain a previous owner's brief.
      if (!calendarController.signal.aborted) setBrief({ text: i18n.t('calendarWorkflow.briefUnavailable') })
    } finally {
      setLoading(false)
      runningRef.current = false
    }
  }, [isGoogleConnected])

  useEffect(() => {
    alive.current = true
    const invalidate = () => {
      if (!calendarScopeRef.current) return
      try { calendarScopeRef.current.assertCurrent(); return } catch { /* old grant */ }
      calendarAbortRef.current?.abort(); abortRef.current?.abort(); setBrief(null)
    }
    window.addEventListener('google-storage-ready', invalidate)
    return () => { alive.current = false; window.removeEventListener('google-storage-ready', invalidate) }
  }, [])

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
      calendarAbortRef.current?.abort()
    }
  }, [isGoogleConnected, runBrief])

  const dismiss = useCallback(() => {
    setDismissed(true)
    abortRef.current?.abort()
    calendarAbortRef.current?.abort()
  }, [])

  const restore = useCallback(() => {
    setDismissed(false)
  }, [])

  // Exécute une action de chip. Le routage est construit côté client : reminder
  // crée une tâche locale ; schedule passe par le chat avec humain dans la boucle.
  const runAction = useCallback((action: BriefAction, item: BriefItem): 'task' | 'chat' | null => {
    if (!alive.current) return null
    const scope = itemScopes.current.get(item)
    if (!scope) return null
    try { scope.assertCurrent() } catch { return null }
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
    // Exposé tel quel : la visibilité du brief DOIT vivre ici (état App) et
    // pas dans un useState local de la Home — un state local se réinitialise
    // au remount (navigation aller-retour) et désynchronise l'UI (carte
    // « vide » à la place du bouton de restauration).
    dismissed,
    dismiss,
    restore,
    runAction,
  }
}
