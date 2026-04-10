import { useState, useCallback, useEffect, useRef } from 'react'
import { useGoogleAuth } from './useGoogleAuth'
import { useGmail } from './useGmail'
import { useDrive } from './useDrive'
import { useBrowser } from './useBrowser'
import { useComputer } from './useComputer'
import { useMemory } from './useMemory'
import { buildContextualPrompt } from '../constants/systemPrompt'
import { createToolExecutor } from '../services/toolExecutor'
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
    if (!googleAuth.isConnected) {
      setSystemPrompt(undefined)
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

    const memorySummary = memoryHook.getPromptContext()
    const prompt = buildContextualPrompt({ gmailSummary, driveSummary, memorySummary })
    setSystemPrompt(prompt)
  }, [googleAuth.isConnected, gmail.messages, drive.files, memoryHook.getPromptContext, setSystemPrompt])

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
        case 'call':
          window.open(`tel:${params.phone}`, '_self')
          break
        case 'link':
          window.open(params.url, '_blank')
          break
        default:
          await executor(action, params)
      }
    },
    [activeId, sendMessage]
  )

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
  }
}
