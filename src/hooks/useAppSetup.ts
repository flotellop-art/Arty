import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { buildToolConfirmMessage } from '../services/toolConfirmation'
import { useGoogleAuth } from './useGoogleAuth'
import { useDrive } from './useDrive'
import { useComputer } from './useComputer'
import { useMemory } from './useMemory'
import { buildContextualPrompt } from '../constants/systemPrompt'
import { buildLocalMemoryPrompt } from '../services/localMemoryService'
import { getCustomInstructions } from '../services/customInstructions'
import { createToolExecutor } from '../services/toolExecutor'
import { getStyle, setStyle, getStylePrompt, STYLE_OPTIONS, type ResponseStyle } from '../services/responseStyles'
import type { Question } from '../components/chat/QuestionModal'
import { isPublicGoogleOAuthProfileEnabled } from '../services/publicGoogleOAuthProfile'
import { isAllowedReportAction, parseTrailRouteId, parseTrailSnapshotId } from '../services/reportActions'
import { toast } from '../services/toast'
import { useNavigate } from 'react-router-dom'

interface ConversationHook {
  activeId: string | null
  sendMessage: (text: string, conversationId?: string) => void
  setSystemPrompt: (prompt: string | undefined) => void
  setToolHandler: (handler: (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>) => void
}

export function useAppSetup(conversation: ConversationHook) {
  // Appelé depuis AppContent, toujours monté sous BrowserRouter (App.tsx) —
  // requis par l'action view_trail (navigation vers /trail/:id).
  const navigate = useNavigate()
  const { activeId, sendMessage, setSystemPrompt, setToolHandler } = conversation

  const { t } = useTranslation()
  const googleAuth = useGoogleAuth()
  const drive = useDrive()
  const computerActions = useComputer()
  const memoryHook = useMemory()
  const noCasaPhase0 = isPublicGoogleOAuthProfileEnabled()
  const mailboxBoundaryPrompt = 'ACCÈS AUX E-MAILS — PRIORITÉ ABSOLUE : tu n\'as accès à aucune boîte mail et tu ne peux ni chercher, ouvrir, envoyer ni modifier un e-mail. Tu peux analyser, résumer ou rédiger uniquement à partir du contenu que l\'utilisateur colle, joint ou partage dans cette conversation. Si le contenu demandé n\'est pas fourni, explique cette limite et demande-lui de copier-coller, transférer ou joindre le message. Ne prétends jamais avoir consulté sa boîte.\n\n'
  const publicGooglePrompt = noCasaPhase0
    ? 'PROFIL GOOGLE PUBLIC : tu n\'as aucun accès global à Drive ou Contacts. Calendar reste disponible.\n\n'
    : ''

  const [actionScreenshot, setActionScreenshot] = useState<string | null>(null)
  const [questionModal, setQuestionModal] = useState<{
    questions: Question[]
    resolve: (answers: string[]) => void
  } | null>(null)
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(getStyle)

  // Listen for style changes from InputBar
  useEffect(() => {
    const handler = (e: Event) => {
      const style = (e as CustomEvent).detail as ResponseStyle
      setResponseStyle(style)
    }
    window.addEventListener('style-changed', handler)
    return () => window.removeEventListener('style-changed', handler)
  }, [])

  const toolExecutorRef = useRef(createToolExecutor(computerActions, drive))

  // Create tool executor and register it
  useEffect(() => {
    toolExecutorRef.current = createToolExecutor(computerActions, drive)
    setToolHandler((name: string, input: Record<string, unknown>) => {
      if (name === 'ask_user') {
        const questions = (input.questions as Question[]) || []
        return new Promise<{ result: string }>((resolve) => {
          setQuestionModal({
            questions,
            resolve: (answers) => {
              setQuestionModal(null)
              const formatted = questions
                .map((q, i) => `${q.question} → ${answers[i] || 'Non répondu'}`)
                .join('\n')
              resolve({ result: `Réponses de l'utilisateur :\n${formatted}` })
            },
          })
        })
      }
      // HITL : un outil sensible (envoi, partage, suppression, publication)
      // déclenché dans la boucle exige un consentement humain explicite AVANT
      // exécution. Sans ça, un contenu lu par Arty (prompt-injection) pouvait
      // déclencher l'action en autonomie. Si l'utilisateur refuse, on rend un
      // résultat clair au modèle pour qu'il ne relance pas l'action.
      const confirmMessage = buildToolConfirmMessage(name, input, t)
      if (confirmMessage && !window.confirm(confirmMessage)) {
        return Promise.resolve({
          result: "L'utilisateur a refusé cette action. Ne la relance pas sans son accord explicite.",
        })
      }

      return toolExecutorRef.current(name, input).then((res) => {
        if (res.screenshot) {
          setActionScreenshot(res.screenshot)
        }
        return res
      })
    })
  }, [computerActions, drive, setToolHandler, t])

  // Auto-fetch Drive and Memory when Google is connected.
  useEffect(() => {
    if (googleAuth.isConnected) {
      if (!noCasaPhase0) {
        drive.fetchFiles()
      }
      memoryHook.loadMemory()
    }
  }, [googleAuth.isConnected, noCasaPhase0])

  // Update system prompt with Google context
  useEffect(() => {
    // On appelle buildContextualPrompt même sans Google pour que la directive
    // de langue (Phase 3 i18n) atteigne les clients IA. Sans ça, les clients
    // tombent sur leurs constantes FR hardcodées et l'UI EN n'a aucun effet
    // sur la langue des réponses.
    if (!googleAuth.isConnected) {
      const prompt = buildLocalMemoryPrompt() + buildContextualPrompt({ customInstructions: getCustomInstructions() }) + getStylePrompt(responseStyle)
      setSystemPrompt(mailboxBoundaryPrompt + publicGooglePrompt + prompt)
      return
    }

    // Roadmap PR 12.1 — injection mémoire conditionnelle.
    // Au boot et aux changements Google/Drive, on construit un prompt avec
    // mémoire COMPLÈTE (fallback legacy safe). Mais quand sendMessage dispatch
    // l'event 'arty-rebuild-prompt' juste avant un appel LLM, on reconstruit
    // avec le user message → mémoire filtrée (économie ~95% des tokens sur
    // requêtes type "salut", "merci", "comment ça va").
    const buildPrompt = (userMessage?: string) => {
      const memorySummary = memoryHook.getPromptContext(userMessage)
      // Drive may be cached for the UI, but its metadata is never silently
      // copied into every model request.
      const prompt = buildLocalMemoryPrompt() + buildContextualPrompt({ memorySummary, customInstructions: getCustomInstructions() }) + getStylePrompt(responseStyle)
      setSystemPrompt(mailboxBoundaryPrompt + publicGooglePrompt + prompt)
    }
    buildPrompt()

    // Listener synchrone — dispatchEvent appelle les handlers en série avant
    // de retourner. Donc systemPromptRef est à jour quand useConversation
    // poursuit après dispatch().
    const onRebuild = (e: Event) => {
      const detail = (e as CustomEvent<{ userMessage?: string }>).detail
      buildPrompt(detail?.userMessage)
    }
    window.addEventListener('arty-rebuild-prompt', onRebuild)
    return () => window.removeEventListener('arty-rebuild-prompt', onRebuild)
  }, [googleAuth.isConnected, memoryHook.getPromptContext, mailboxBoundaryPrompt, publicGooglePrompt, setSystemPrompt, responseStyle])

  // Handle action buttons clicked in reports
  // ⚠️ ALLOWLIST POSITIVE (audit 14 juin) — pendant de buildToolConfirmMessage
  // (toolConfirmation.ts) qui garde la boucle d'outils LLM. Les deux listes
  // sont maintenues SÉPARÉMENT : à l'ajout d'une action/d'un tool sensible,
  // mettre à jour les deux et le test de parité de toolConfirmation.test.ts.
  const handleAction = useCallback(
    async (action: string, params: Record<string, string>) => {
      if (!isAllowedReportAction(action)) {
        console.warn('[action] action de bouton inconnue ignorée:', action)
        return
      }
      const executor = toolExecutorRef.current
      switch (action) {
        case 'reply': {
          const text = params.text || params.value || ''
          if (text && activeId) {
            sendMessage(text, activeId)
          }
          break
        }
        case 'create_event':
          if (!window.confirm(t('chat.actionConfirm.event', { title: params.title || params.summary || '?' }))) break
          await executor('create_calendar_event', params)
          break
        case 'publish_wp':
          if (!window.confirm(t('chat.actionConfirm.wp', { title: params.title || '?' }))) break
          await executor('wp_create_post', { title: params.title || '', content: params.content || '', status: params.status || 'draft' })
          break
        case 'search_web':
          await executor('web_search', { query: params.query || '' })
          break
        case 'call': {
          // Valide le numéro avant d'ouvrir le composeur : un `tel:` injecté
          // pourrait être un numéro surtaxé (prompt-injection sur natif).
          const phone = params.phone || ''
          if (/^\+?[\d\s().-]{7,20}$/.test(phone)) {
            window.open(`tel:${phone}`, '_self')
          }
          break
        }
        case 'link': {
          // http/https uniquement + noopener (la fenêtre ouverte ne doit pas
          // accéder à window.opener). `params.url` vient du LLM.
          try {
            const u = new URL(params.url || '')
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              window.open(u.href, '_blank', 'noopener,noreferrer')
            }
          } catch {
            /* URL invalide → ignorer */
          }
          break
        }
        case 'view_trail': {
          // Le bouton ne transporte qu'une référence locale opaque. La page
          // exige ensuite que le snapshot existe réellement dans IndexedDB :
          // un UUID inventé ou injecté par le LLM reste inerte.
          const trailId = parseTrailSnapshotId(params.trailId)
          if (trailId !== null) navigate(`/trail/${trailId}`)
          else if (parseTrailRouteId(params.routeId) !== null) toast(t('trailPage.legacyButton'), 'info')
          break
        }
        default:
          // Défense en profondeur si l'allowlist et le switch divergent.
          console.warn('[action] action autorisée sans handler:', action)
      }
    },
    [activeId, sendMessage, t, navigate]
  )

  const changeStyle = useCallback((style: ResponseStyle) => {
    setStyle(style)
    setResponseStyle(style)
  }, [])

  return {
    googleAuth,
    drive,
    computerActions,
    actionScreenshot,
    setActionScreenshot,
    questionModal,
    handleAction,
    responseStyle,
    changeStyle,
    styleOptions: STYLE_OPTIONS,
  }
}
