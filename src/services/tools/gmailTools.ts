import type { useGmail } from '../../hooks/useGmail'
import type { ToolHandler } from './types'
import { callGoogleApi } from '../googleApiHelper'

// Best-effort extension from a MIME type, used when the proxy/client
// doesn't have a real filename for the attachment. Claude's API only
// uses `name` for display, so the value is purely cosmetic.
function guessExt(mime: string): string {
  const m = mime.toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return m.split('/')[1] || 'bin'
  if (m.includes('wordprocessingml')) return 'docx'
  if (m === 'application/msword') return 'doc'
  if (m.includes('spreadsheetml')) return 'xlsx'
  if (m === 'application/vnd.ms-excel') return 'xls'
  if (m.includes('presentationml')) return 'pptx'
  if (m === 'application/vnd.ms-powerpoint') return 'ppt'
  return 'bin'
}

export const gmailToolDefinitions = [
  {
    name: 'read_emails',
    description: 'Lit les 10 derniers emails non lus de Gmail.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'read_email',
    description: "Lit le contenu complet d'un email spécifique par son ID.",
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' as const, description: "ID de l'email (obtenu via read_emails)" },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'read_email_attachment',
    description: "Lit le contenu d'une pièce jointe d'un email (PDF, Word, Excel, image, texte, etc.). Utilise les IDs et le mimeType obtenus via read_email.",
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' as const, description: "ID de l'email" },
        attachment_id: { type: 'string' as const, description: "ID de la pièce jointe (obtenu via read_email)" },
        mime_type: { type: 'string' as const, description: "MIME type de la pièce jointe (obtenu via read_email). Indispensable pour les binaires non-PDF." },
        filename: { type: 'string' as const, description: "Nom du fichier (obtenu via read_email). Optionnel mais utile." },
      },
      required: ['message_id', 'attachment_id'],
    },
  },
  {
    name: 'send_email',
    description: "Envoie un email. TOUJOURS demander confirmation à l'utilisateur avant d'envoyer.",
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const, description: 'Adresse email du destinataire' },
        subject: { type: 'string' as const, description: 'Objet' },
        body: { type: 'string' as const, description: 'Corps du message' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_email',
    description: "Répond à un email existant. TOUJOURS demander confirmation à l'utilisateur.",
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const },
        subject: { type: 'string' as const },
        body: { type: 'string' as const },
        thread_id: { type: 'string' as const, description: 'ID du thread (obtenu via read_emails)' },
      },
      required: ['to', 'subject', 'body', 'thread_id'],
    },
  },
  {
    name: 'search_emails',
    description: 'Cherche des emails par mot-clé, expéditeur, ou sujet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Recherche Gmail (ex: "from:client@email.com" ou "devis facade")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive un email (le retire de la boîte de réception).',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string' as const } },
      required: ['message_id'],
    },
  },
  {
    name: 'delete_email',
    description: 'Supprime un email (met dans la corbeille). CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string' as const } },
      required: ['message_id'],
    },
  },
  {
    name: 'star_email',
    description: 'Marque un email comme important/étoilé.',
    input_schema: {
      type: 'object' as const,
      properties: { message_id: { type: 'string' as const } },
      required: ['message_id'],
    },
  },
  {
    name: 'create_draft_email',
    description: 'Crée un brouillon email sans envoyer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const },
        subject: { type: 'string' as const },
        body: { type: 'string' as const },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'label_email',
    description: 'Applique un label à un email (IMPORTANT, STARRED, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' as const },
        label: { type: 'string' as const },
      },
      required: ['message_id', 'label'],
    },
  },
]

export function createGmailHandlers(gmail: ReturnType<typeof useGmail>): Record<string, ToolHandler> {
  return {
    read_emails: async () => {
      const messages = await gmail.fetchMessages()
      if (messages && messages.length > 0) {
        const summary = messages.slice(0, 10).map((m, i) =>
          `${i + 1}. [ID:${m.id}] [Thread:${m.threadId}] De: ${m.from} | Objet: ${m.subject} | ${m.snippet}`
        ).join('\n')
        return { result: `${messages.length} emails non lus:\n${summary}` }
      }
      return { result: messages?.length === 0 ? 'Aucun email non lu.' : 'Erreur: impossible de lire Gmail. Google non connecté ?' }
    },

    read_email: async (input) => {
      const messageId = input.message_id as string
      if (!messageId) return { result: 'Erreur: ID message manquant.' }
      const email = await gmail.readMessage(messageId)
      if (email) {
        let result = `De: ${email.from}\nÀ: ${email.to}\nObjet: ${email.subject}\nDate: ${email.date}\n\n${email.body}`
        const attachments = (email as unknown as Record<string, unknown>).attachments as Array<{ id: string; filename: string; mimeType: string; size: number }> | undefined
        if (attachments && attachments.length > 0) {
          result += `\n\nPièces jointes (${attachments.length}) :\n`
          result += attachments.map((a, i) =>
            `${i + 1}. ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}Ko) — attachment_id: ${a.id}`
          ).join('\n')
          result += "\n\nPour lire une PJ : appelle read_email_attachment avec message_id, attachment_id, mime_type et filename ci-dessus. Le mime_type est obligatoire pour les fichiers binaires non-PDF (Word, Excel, image)."
        }
        return { result }
      }
      return { result: 'Erreur: impossible de lire cet email.' }
    },

    read_email_attachment: async (input) => {
      const messageId = input.message_id as string
      const attachmentId = input.attachment_id as string
      const mimeTypeHint = (input.mime_type as string | undefined) || ''
      const filenameHint = (input.filename as string | undefined) || ''
      if (!messageId || !attachmentId) return { result: 'Erreur: message_id et attachment_id requis.' }
      try {
        const data = await callGoogleApi('/api/gmail/action', {
          type: 'attachment',
          message_id: messageId,
          attachment_id: attachmentId,
          mimeType: mimeTypeHint,
          filename: filenameHint,
        })

        // Forwardable binary (PDF, Word, Excel, PowerPoint, images): pass
        // raw bytes to Claude via fileData. Claude reads these natively
        // through `document`/`image` content blocks — no server-side OCR
        // needed (pdf-parse is Node-only and doesn't run on Cloudflare
        // Pages Functions). Without this branch, attachments came back
        // as a placeholder string and Claude hallucinated about
        // "non-standard encoding" instead of actually reading them.
        if (data.base64 && data.mimeType) {
          const sizeKb = data.size ? Math.round((data.size as number) / 1024) : 0
          const name = (data.filename as string | undefined) || filenameHint || `attachment.${guessExt(data.mimeType as string)}`
          const kind = data.type === 'image' ? 'image' : data.type === 'pdf' ? 'PDF' : 'document'
          return {
            result: `Pièce jointe ${kind}${sizeKb ? ` (${sizeKb} Ko)` : ''} — fichier brut transmis pour lecture directe.`,
            fileData: {
              name,
              mimeType: data.mimeType as string,
              base64: data.base64 as string,
            },
          }
        }

        if (data.content) {
          return { result: `Contenu de la pièce jointe (${data.type || 'inconnu'})${data.pages ? `, ${data.pages} pages` : ''} :\n\n${data.content}` }
        }
        return { result: data.error || 'Erreur: impossible de lire la pièce jointe.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'lecture pièce jointe échouée.'}` }
      }
    },

    send_email: async (input) => {
      const { to, subject, body } = input as { to: string; subject: string; body: string }
      const res = await gmail.sendEmail({ to, subject, body })
      if (res) {
        return { result: `Email envoyé avec succès à ${to}. ID: ${res.id}` }
      }
      return { result: 'Erreur: envoi échoué.' }
    },

    reply_email: async (input) => {
      const { to, subject, body, thread_id } = input as { to: string; subject: string; body: string; thread_id: string }
      const res = await gmail.sendEmail({ to, subject, body, threadId: thread_id })
      if (res) {
        return { result: `Réponse envoyée à ${to}. ID: ${res.id}` }
      }
      return { result: 'Erreur: réponse échouée.' }
    },

    search_emails: async (input) => {
      const query = input.query as string
      if (!query) return { result: 'Erreur: requête manquante.' }
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'search', query })
        if (data.messages && data.messages.length > 0) {
          const summary = data.messages.map((m: { id: string; from: string; subject: string; snippet: string }, i: number) =>
            `${i + 1}. [ID:${m.id}] De: ${m.from} | ${m.subject} | ${m.snippet}`
          ).join('\n')
          return { result: `${data.messages.length} résultats pour "${query}":\n${summary}` }
        }
        return { result: `Aucun email trouvé pour "${query}".` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'recherche email échouée.'}` }
      }
    },

    archive_email: async (input) => {
      const messageId = input.message_id as string
      if (!messageId) return { result: 'Erreur: ID manquant.' }
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'archive', id: messageId })
        return { result: data.error ? `Erreur: ${data.error}` : 'Email archivé.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'archivage échoué.'}` }
      }
    },

    delete_email: async (input) => {
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'delete', id: input.message_id })
        return { result: data.success ? 'Email supprimé.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'suppression email échouée.'}` }
      }
    },

    star_email: async (input) => {
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'star', id: input.message_id })
        return { result: data.success ? 'Email marqué important.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'étoilage échoué.'}` }
      }
    },

    create_draft_email: async (input) => {
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'draft', to: input.to, subject: input.subject, body: input.body })
        return { result: data.success ? 'Brouillon créé dans Gmail.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'création brouillon échouée.'}` }
      }
    },

    label_email: async (input) => {
      try {
        const data = await callGoogleApi('/api/gmail/action', { type: 'label', id: input.message_id, label: input.label })
        return { result: data.success ? `Label "${input.label}" appliqué.` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'label échoué.'}` }
      }
    },
  }
}
