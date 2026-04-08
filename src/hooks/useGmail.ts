import { useState, useCallback } from 'react'
import type { GmailMessage, GmailFullMessage, EmailDraft } from '../types/google'
import * as gmail from '../services/gmailClient'

export function useGmail() {
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [currentEmail, setCurrentEmail] = useState<GmailFullMessage | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMessages = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const msgs = await gmail.listUnreadEmails()
      setMessages(msgs)
      return msgs
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gmail'
      setError(msg)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  const readMessage = useCallback(async (messageId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const email = await gmail.readEmail(messageId)
      setCurrentEmail(email)
      return email
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lecture'
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const sendEmail = useCallback(async (draft: EmailDraft) => {
    setIsSending(true)
    setError(null)
    try {
      const result = await gmail.sendEmail(draft)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur envoi'
      setError(msg)
      return null
    } finally {
      setIsSending(false)
    }
  }, [])

  return {
    messages,
    currentEmail,
    isLoading,
    isSending,
    error,
    fetchMessages,
    readMessage,
    sendEmail,
  }
}
