import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'
import type { useBrowser } from '../hooks/useBrowser'

interface ToolResult {
  result: string
  screenshot?: string
}

export function createToolExecutor(
  computer: ReturnType<typeof useComputer>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
  browserActions: ReturnType<typeof useBrowser>,
) {
  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    try {
      switch (name) {
        // --- PC Control ---
        case 'open_app': {
          const app = (input.app as string) || ''
          const res = await computer.openApp(app)
          if (res?.success) {
            return { result: `${app} ouvert avec succès sur le PC.`, screenshot: res.screenshot }
          }
          return { result: `Erreur: ${res?.error || 'PC non joignable. Le PC est peut-être éteint.'}` }
        }

        case 'screenshot_pc': {
          const res = await computer.screenshot()
          if (res?.success) {
            return { result: 'Screenshot capturé avec succès.', screenshot: res.screenshot }
          }
          return { result: `Erreur: ${res?.error || 'PC non joignable.'}` }
        }

        // --- Gmail ---
        case 'read_emails': {
          const messages = await gmail.fetchMessages()
          if (messages && messages.length > 0) {
            const summary = messages.slice(0, 10).map((m, i) =>
              `${i + 1}. [ID:${m.id}] [Thread:${m.threadId}] De: ${m.from} | Objet: ${m.subject} | ${m.snippet}`
            ).join('\n')
            return { result: `${messages.length} emails non lus:\n${summary}` }
          }
          return { result: messages?.length === 0 ? 'Aucun email non lu.' : 'Erreur: impossible de lire Gmail. Google non connecté ?' }
        }

        case 'read_email': {
          const messageId = input.message_id as string
          if (!messageId) return { result: 'Erreur: ID message manquant.' }
          const email = await gmail.readMessage(messageId)
          if (email) {
            return { result: `De: ${email.from}\nÀ: ${email.to}\nObjet: ${email.subject}\nDate: ${email.date}\n\n${email.body}` }
          }
          return { result: 'Erreur: impossible de lire cet email.' }
        }

        case 'send_email': {
          const { to, subject, body } = input as { to: string; subject: string; body: string }
          const res = await gmail.sendEmail({ to, subject, body })
          if (res) {
            return { result: `Email envoyé avec succès à ${to}. ID: ${res.id}` }
          }
          return { result: 'Erreur: envoi échoué.' }
        }

        case 'reply_email': {
          const { to, subject, body, thread_id } = input as { to: string; subject: string; body: string; thread_id: string }
          const res = await gmail.sendEmail({ to, subject, body, threadId: thread_id })
          if (res) {
            return { result: `Réponse envoyée à ${to}. ID: ${res.id}` }
          }
          return { result: 'Erreur: réponse échouée.' }
        }

        // --- Google Drive ---
        case 'list_drive': {
          const files = await drive.fetchFiles()
          if (files && files.length > 0) {
            const summary = files.slice(0, 30).map((f, i) =>
              `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
            ).join('\n')
            return { result: `${files.length} fichiers:\n${summary}` }
          }
          return { result: files?.length === 0 ? 'Aucun fichier sur Drive.' : 'Erreur: Google non connecté ?' }
        }

        case 'search_drive': {
          const query = input.query as string
          if (!query) return { result: 'Erreur: requête manquante.' }
          const files = await drive.fetchFiles(undefined, query)
          if (files && files.length > 0) {
            const summary = files.map((f, i) =>
              `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
            ).join('\n')
            return { result: `${files.length} fichiers trouvés pour "${query}":\n${summary}` }
          }
          return { result: `Aucun fichier trouvé pour "${query}".` }
        }

        case 'read_drive_file': {
          const fileId = input.file_id as string
          if (!fileId) return { result: 'Erreur: ID fichier manquant.' }
          const file = await drive.readFile(fileId)
          if (file) {
            return { result: `Fichier: ${file.name}\nType: ${file.mimeType}\n\nContenu:\n${file.content}` }
          }
          return { result: 'Erreur: impossible de lire ce fichier.' }
        }

        case 'create_drive_file': {
          const fileName = input.name as string
          const content = input.content as string
          if (!fileName || !content) return { result: 'Erreur: nom ou contenu manquant.' }
          const res = await drive.createFile(fileName, content)
          if (res) {
            return { result: `Document "${res.name}" créé sur Drive.${res.webViewLink ? ` Lien: ${res.webViewLink}` : ''}` }
          }
          return { result: 'Erreur: création échouée.' }
        }

        // --- Web ---
        case 'web_search': {
          const query = input.query as string
          if (!query) return { result: 'Erreur: requête manquante.' }
          try {
            const res = await fetch('/api/browser/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query }),
            })
            const data = await res.json()
            if (data.results && data.results.length > 0) {
              const summary = data.results.map((r: { title: string; url: string; snippet: string }, i: number) =>
                `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
              ).join('\n\n')
              return { result: `Résultats pour "${query}":\n\n${summary}` }
            }
            return { result: `Aucun résultat pour "${query}".` }
          } catch {
            return { result: 'Erreur: recherche web échouée.' }
          }
        }

        case 'search_price': {
          const product = input.product as string
          const res = await browserActions.searchPrices(product)
          if (res) {
            const table = res.results.map(r =>
              `${r.source}: ${r.product} — ${r.price}`
            ).join('\n')
            return { result: `Prix pour "${product}":\n${table}` }
          }
          return { result: 'Erreur: recherche prix échouée.' }
        }

        // --- WordPress ---
        case 'publish_wordpress': {
          const title = input.title as string
          const content = input.content as string
          const status = (input.status as string) || 'draft'
          const res = await browserActions.publishWP({ title, content, status: status as 'draft' | 'publish' })
          if (res) {
            return { result: `Article "${title}" ${status === 'publish' ? 'publié' : 'enregistré en brouillon'} sur WordPress.${res.url ? ` URL: ${res.url}` : ''}` }
          }
          return { result: 'Erreur: publication WordPress échouée.' }
        }

        default:
          return { result: `Outil inconnu: ${name}` }
      }
    } catch (err) {
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
