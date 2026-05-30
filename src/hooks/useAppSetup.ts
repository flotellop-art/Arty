import { useState, useCallback, useEffect, useRef } from 'react'
import { useGoogleAuth } from './useGoogleAuth'
import { useGmail } from './useGmail'
import { useDrive } from './useDrive'
import { useBrowser } from './useBrowser'
import { useComputer } from './useComputer'
import { useMemory } from './useMemory'
import { buildContextualPrompt } from '../constants/systemPrompt'
import { buildLocalMemoryPrompt } from '../services/localMemoryService'
import { createToolExecutor } from '../services/toolExecutor'
import { getStyle, setStyle, getStylePrompt, STYLE_OPTIONS, type ResponseStyle } from '../services/responseStyles'
import type { Question } from '../components/chat/QuestionModal'
import type { GmailMessage } from '../types/google'

interface ConversationHook {
  activeId: string | null
  sendMessage: (text: string, conversationId?: string) => void
  setSystemPrompt: (prompt: string | undefined) => void
  setToolHandler: (handler: (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>) => void
}

export function useAppSetup(conversation: ConversationHook) {
  const { activeId, sendMessage, setSystemPrompt, setToolHandler } = conversation

  const googleAuth = useGoogleAuth()
  const gmail = useGmail()
  const drive = useDrive()
  const browserActions = useBrowser()
  const computerActions = useComputer()
  const memoryHook = useMemory()

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

  const toolExecutorRef = useRef(createToolExecutor(computerActions, gmail, drive, browserActions))

  // Create tool executor and register it
  useEffect(() => {
    toolExecutorRef.current = createToolExecutor(computerActions, gmail, drive, browserActions)
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
      return toolExecutorRef.current(name, input).then((res) => {
        if (res.screenshot) {
          setActionScreenshot(res.screenshot)
        }
        return res
      })
    })
  }, [computerActions, gmail, drive, browserActions, setToolHandler])

  // Auto-fetch Gmail, Drive, and Memory when Google is connected
  useEffect(() => {
    if (googleAuth.isConnected) {
      gmail.fetchMessages()
      drive.fetchFiles()
      memoryHook.loadMemory()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAuth.isConnected])

  // Update system prompt with Google context
  useEffect(() => {
    // On appelle buildContextualPrompt même sans Google pour que la directive
    // de langue (Phase 3 i18n) atteigne les clients IA. Sans ça, les clients
    // tombent sur leurs constantes FR hardcodées et l'UI EN n'a aucun effet
    // sur la langue des réponses.
    if (!googleAuth.isConnected) {
      const prompt = buildLocalMemoryPrompt() + buildContextualPrompt() + getStylePrompt(responseStyle)
      setSystemPrompt(prompt)
      return
    }

    let gmailSummary: string | undefined
    if (gmail.messages.length > 0) {
      gmailSummary = `${gmail.messages.length} emails non lus :\n` +
        gmail.messages
          .slice(0, 5)
          .map((m: GmailMessage) => `- De: ${m.from} | Objet: ${m.subject}`)
          .join('\n')
    }

    let driveSummary: string | undefined
    if (drive.files.length > 0) {
      driveSummary = `Fichiers récents sur Drive :\n` +
        drive.files
          .slice(0, 5)
          .map((f) => `- ${f.name} (${f.mimeType})`)
          .join('\n')
    }

    // Roadmap PR 12.1 — injection mémoire conditionnelle.
    // Au boot et aux changements Google/Drive, on construit un prompt avec
    // mémoire COMPLÈTE (fallback legacy safe). Mais quand sendMessage dispatch
    // l'event 'arty-rebuild-prompt' juste avant un appel LLM, on reconstruit
    // avec le user message → mémoire filtrée (économie ~95% des tokens sur
    // requêtes type "salut", "merci", "comment ça va").
    const buildPrompt = (userMessage?: string) => {
      const memorySummary = memoryHook.getPromptContext(userMessage)
      const prompt = buildLocalMemoryPrompt() + buildContextualPrompt({ gmailSummary, driveSummary, memorySummary }) + getStylePrompt(responseStyle)
      setSystemPrompt(prompt)
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
  }, [googleAuth.isConnected, gmail.messages, drive.files, memoryHook.getPromptContext, setSystemPrompt, responseStyle])

  // Handle action buttons clicked in reports
  const handleAction = useCallback(
    async (action: string, params: Record<string, string>) => {
      const executor = toolExecutorRef.current
      switch (action) {
        case 'reply': {
          const text = params.text || params.value || ''
          if (text && activeId) {
            sendMessage(text, activeId)
          }
          break
        }
        case 'send_email':
          await executor('send_email', params)
          break
        case 'save_drive':
          await executor('create_drive_file', { name: params.name || 'Document', content: params.content || '' })
          break
        case 'create_event':
          await executor('create_calendar_event', params)
          break
        case 'publish_wp':
          await executor('wp_create_post', { title: params.title || '', content: params.content || '', status: params.status || 'draft' })
          break
        case 'search_web':
          await executor('web_search', { query: params.query || '' })
          break
        case 'call': {
          // Sécurité : le numéro provient d'un attribut data-* généré par le LLM.
          // On ne garde que les caractères d'un numéro valide avant `tel:`.
          const phone = String(params.phone ?? '').replace(/[^0-9+().\- ]/g, '').trim()
          if (phone) window.open(`tel:${phone}`, '_self')
          break
        }
        case 'link': {
          // Sécurité : l'URL provient d'un data-* généré par le LLM, que
          // rehype-sanitize n'assainit pas. On n'ouvre QUE http(s) pour bloquer
          // javascript:/data:/intent: (exécution de protocole arbitraire).
          const raw = String(params.url ?? '')
          let safeUrl: string | null = null
          try {
            const u = new URL(raw)
            if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href
          } catch {
            safeUrl = null
          }
          if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer')
          else console.warn('[useAppSetup] Lien ignoré (protocole non autorisé):', raw)
          break
        }
        default:
          await executor(action, params)
      }
    },
    [activeId, sendMessage]
  )

  const changeStyle = useCallback((style: ResponseStyle) => {
    setStyle(style)
    setResponseStyle(style)
  }, [])

  return {
    googleAuth,
    gmail,
    drive,
    browserActions,
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
