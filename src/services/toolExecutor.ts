import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'
import type { useBrowser } from '../hooks/useBrowser'
import { getValidAccessToken } from './googleAuth'
import { openReport } from './reportGenerator'
import { safeJson } from '../utils/safeJson'
import { updateMemory } from './memoryService'

async function getGoogleToken(): Promise<string | null> {
  return getValidAccessToken()
}

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
        // --- Reports ---
        case 'generate_report': {
          const title = input.title as string
          const content = input.content as string
          const reportId = openReport(title, content)
          return { result: `Rapport "${title}" prêt. Lien : [📄 Ouvrir le rapport](${window.location.origin}/report/${reportId})` }
        }

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
            let result = `De: ${email.from}\nÀ: ${email.to}\nObjet: ${email.subject}\nDate: ${email.date}\n\n${email.body}`
            const attachments = (email as unknown as Record<string, unknown>).attachments as Array<{ id: string; filename: string; mimeType: string; size: number }> | undefined
            if (attachments && attachments.length > 0) {
              result += `\n\nPièces jointes (${attachments.length}) :\n`
              result += attachments.map((a, i) =>
                `${i + 1}. ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}Ko) — attachment_id: ${a.id}`
              ).join('\n')
              result += '\n\nUtilise read_email_attachment avec le message_id et attachment_id pour lire le contenu des pièces jointes.'
            }
            return { result }
          }
          return { result: 'Erreur: impossible de lire cet email.' }
        }

        case 'read_email_attachment': {
          const messageId = input.message_id as string
          const attachmentId = input.attachment_id as string
          if (!messageId || !attachmentId) return { result: 'Erreur: message_id et attachment_id requis.' }
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'attachment', message_id: messageId, attachment_id: attachmentId }),
            })
            const data = await safeJson(res)
            if (data.content) {
              return { result: `Contenu de la pièce jointe (${data.type || 'inconnu'})${data.pages ? `, ${data.pages} pages` : ''} :\n\n${data.content}` }
            }
            return { result: data.error || 'Erreur: impossible de lire la pièce jointe.' }
          } catch {
            return { result: 'Erreur: lecture pièce jointe échouée.' }
          }
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
          try {
            const folderId = input.folder_id as string | undefined
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté. Reconnecte-toi.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'list', folderId }),
            })
            const data = await safeJson(res)
            if (data.error) return { result: `Erreur Drive: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}` }
            const files = data.files || []
            if (files.length > 0) {
              const summary = files.slice(0, 50).map((f: { id: string; name: string; mimeType: string }, i: number) =>
                `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
              ).join('\n')
              return { result: `${files.length} fichiers${folderId ? ' dans ce dossier' : ''}:\n${summary}` }
            }
            return { result: folderId ? 'Dossier vide.' : `Aucun fichier sur Drive. (debug: ${JSON.stringify(data.debug || {})})` }
          } catch (err) {
            return { result: `Erreur Drive: ${err instanceof Error ? err.message : 'inconnu'}` }
          }
        }

        case 'search_drive': {
          const query = input.query as string
          if (!query) return { result: 'Erreur: requête manquante.' }
          try {
            const files = await drive.fetchFiles(undefined, query)
            if (files && files.length > 0) {
              const summary = files.map((f, i) =>
                `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
              ).join('\n')
              return { result: `${files.length} fichiers trouvés pour "${query}":\n${summary}` }
            }
            return { result: `Aucun fichier trouvé pour "${query}". Essaie avec d'autres mots-clés ou liste le contenu des dossiers avec list_drive.` }
          } catch (err) {
            return { result: `Erreur recherche Drive: ${err instanceof Error ? err.message : 'Google non connecté ?'}` }
          }
        }

        case 'read_drive_file': {
          const fileId = input.file_id as string
          if (!fileId) return { result: 'Erreur: ID fichier manquant.' }
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'read', id: fileId }),
            })
            const data = await safeJson(res)
            if (data.error) return { result: `Erreur lecture: ${data.error}` }
            return { result: `Fichier: ${data.name}\nType: ${data.mimeType}\n\nContenu:\n${data.content}` }
          } catch (err) {
            return { result: `Erreur: ${err instanceof Error ? err.message : 'lecture échouée'}` }
          }
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
        case 'delete_drive_file': {
          const fileId = input.file_id as string
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'delete', id: fileId }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Fichier supprimé.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur suppression.' } }
        }

        case 'rename_drive_file': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'rename', id: input.file_id, name: input.new_name }),
            })
            const data = await safeJson(res)
            return { result: data.success ? `Fichier renommé en "${data.name}".` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur renommage.' } }
        }

        case 'move_drive_file': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'move', id: input.file_id, folderId: input.folder_id }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Fichier déplacé.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur déplacement.' } }
        }

        case 'create_drive_folder': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'create_folder', name: input.name, parentId: input.parent_id }),
            })
            const data = await safeJson(res)
            return { result: data.id ? `Dossier "${data.name}" créé.${data.webViewLink ? ` Lien: ${data.webViewLink}` : ''}` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur création dossier.' } }
        }

        // --- Google Contacts ---
        case 'search_contacts': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/contacts/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'search', query: input.query }),
            })
            const data = await safeJson(res)
            if (data.contacts && data.contacts.length > 0) {
              const list = data.contacts.map((c: { name: string; email: string; phone: string; company: string }, i: number) =>
                `${i + 1}. ${c.name}${c.phone ? ` — ${c.phone}` : ''}${c.email ? ` — ${c.email}` : ''}${c.company ? ` (${c.company})` : ''}`
              ).join('\n')
              return { result: `${data.contacts.length} contacts:\n${list}` }
            }
            return { result: 'Aucun contact trouvé.' }
          } catch { return { result: 'Erreur contacts.' } }
        }

        case 'create_contact': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/contacts/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'create', ...input }),
            })
            const data = await safeJson(res)
            return { result: data.success ? `Contact "${input.name}" ajouté.` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur création contact.' } }
        }

        // --- Gmail avancé ---
        case 'delete_email': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'delete', id: input.message_id }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Email supprimé.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur suppression email.' } }
        }

        case 'star_email': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'star', id: input.message_id }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Email marqué important.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur.' } }
        }

        // --- Calendar avancé ---
        case 'update_calendar_event': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/calendar/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'update', eventId: input.event_id, title: input.title, start: input.start, end: input.end, location: input.location }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'RDV modifié.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur modification RDV.' } }
        }

        case 'delete_calendar_event': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/calendar/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'delete', eventId: input.event_id }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'RDV supprimé.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur suppression RDV.' } }
        }

        // --- Utilitaires métier ---
        case 'calculate_surface': {
          try {
            const walls = JSON.parse(input.walls as string) as Array<{ width: number; height: number }>
            const openings = input.openings ? JSON.parse(input.openings as string) as Array<{ width: number; height: number; count: number }> : []

            let totalWall = 0
            walls.forEach(w => { totalWall += w.width * w.height })

            let totalOpenings = 0
            openings.forEach(o => { totalOpenings += o.width * o.height * (o.count || 1) })

            const net = totalWall - totalOpenings
            return { result: `Surface brute : ${totalWall.toFixed(2)} m²\nOuvertures : ${totalOpenings.toFixed(2)} m²\nSurface nette : ${net.toFixed(2)} m²` }
          } catch { return { result: 'Erreur: format JSON invalide.' } }
        }

        case 'calculate_distance': {
          const dest = input.destination as string
          try {
            const res = await fetch('/api/browser/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: `distance Valence 26000 vers ${dest}` }),
            })
            const data = await safeJson(res)
            if (data.results && data.results.length > 0) {
              return { result: `Recherche distance Valence → ${dest}:\n${data.results.slice(0, 3).map((r: { title: string; snippet: string }) => `${r.title}: ${r.snippet}`).join('\n')}` }
            }
            return { result: `Impossible de calculer la distance vers ${dest}.` }
          } catch { return { result: 'Erreur calcul distance.' } }
        }

        // --- Google Calendar ---
        case 'list_calendar': {
          const days = (input.days as number) || 7
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/calendar/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'list', days }),
            })
            const data = await safeJson(res)
            if (data.events && data.events.length > 0) {
              const summary = data.events.map((e: { title: string; start: string; end: string; location: string }, i: number) => {
                const start = new Date(e.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                return `${i + 1}. ${start} — ${e.title}${e.location ? ` (${e.location})` : ''}`
              }).join('\n')
              return { result: `${data.events.length} événements dans les ${days} prochains jours:\n${summary}` }
            }
            return { result: `Aucun événement dans les ${days} prochains jours.` }
          } catch { return { result: 'Erreur calendrier.' } }
        }

        case 'create_calendar_event': {
          const { title, start, end, location, description } = input as { title: string; start: string; end?: string; location?: string; description?: string }
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/calendar/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'create', title, start, end, location, description }),
            })
            const data = await safeJson(res)
            if (data.id) {
              return { result: `RDV "${data.title}" créé le ${new Date(data.start).toLocaleString('fr-FR')}.${data.link ? ` Lien: ${data.link}` : ''}` }
            }
            return { result: `Erreur: ${data.error || 'création échouée'}` }
          } catch { return { result: 'Erreur création RDV.' } }
        }

        // --- Gmail avancé ---
        case 'search_emails': {
          const query = input.query as string
          if (!query) return { result: 'Erreur: requête manquante.' }
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'search', query }),
            })
            const data = await safeJson(res)
            if (data.messages && data.messages.length > 0) {
              const summary = data.messages.map((m: { id: string; from: string; subject: string; snippet: string }, i: number) =>
                `${i + 1}. [ID:${m.id}] De: ${m.from} | ${m.subject} | ${m.snippet}`
              ).join('\n')
              return { result: `${data.messages.length} résultats pour "${query}":\n${summary}` }
            }
            return { result: `Aucun email trouvé pour "${query}".` }
          } catch { return { result: 'Erreur recherche email.' } }
        }

        case 'archive_email': {
          const messageId = input.message_id as string
          if (!messageId) return { result: 'Erreur: ID manquant.' }
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'archive', id: messageId }),
            })
            const data = await safeJson(res)
            return { result: data.error ? `Erreur: ${data.error}` : 'Email archivé.' }
          } catch { return { result: 'Erreur archivage.' } }
        }

        // --- Météo ---
        case 'get_weather': {
          const city = (input.city as string) || 'Valence'
          try {
            const res = await fetch('/api/browser/weather', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ city }),
            })
            const data = await safeJson(res)
            if (data.current) {
              let result = `Météo ${data.city} : ${data.current.condition}, ${data.current.temperature}°C, vent ${data.current.wind} km/h\n\nPrévisions :\n`
              result += data.forecast.map((d: { date: string; min: number; max: number; rain_chance: number; condition: string }) =>
                `${d.date} : ${d.condition} ${d.min}°/${d.max}° — pluie ${d.rain_chance}%`
              ).join('\n')
              return { result }
            }
            return { result: `Erreur: ${data.error || 'météo indisponible'}` }
          } catch { return { result: 'Erreur météo.' } }
        }

        // --- Utilitaires ---
        case 'calculate_quote': {
          try {
            const items = JSON.parse(input.items as string) as Array<{ label: string; surface: number; price_per_m2: number }>
            const tvaRate = (input.tva_rate as number) || 10
            const clientName = (input.client_name as string) || ''

            let totalHT = 0
            const lines = items.map(item => {
              const lineTotal = item.surface * item.price_per_m2
              totalHT += lineTotal
              return `${item.label} : ${item.surface} m² × ${item.price_per_m2}€ = ${lineTotal.toFixed(2)}€ HT`
            })

            const tva = totalHT * tvaRate / 100
            const ttc = totalHT + tva

            let result = `DEVIS${clientName ? ` — ${clientName}` : ''}\n${'='.repeat(40)}\n`
            result += lines.join('\n')
            result += `\n${'—'.repeat(40)}`
            result += `\nTotal HT : ${totalHT.toFixed(2)}€`
            result += `\nTVA ${tvaRate}% : ${tva.toFixed(2)}€`
            result += `\nTotal TTC : ${ttc.toFixed(2)}€`

            return { result }
          } catch { return { result: 'Erreur: format items invalide.' } }
        }

        // --- Mémoire persistante ---
        case 'update_memory': {
          const category = input.category as 'profil' | 'clients' | 'chantiers' | 'notes'
          const data = input.data
          if (!category || !data) return { result: 'Erreur: catégorie ou données manquantes.' }
          const res = await updateMemory(category, data)
          return { result: res.message }
        }

        // web_search is now a server-side tool handled by Anthropic API directly

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

        // --- Gmail extra ---
        case 'create_draft_email': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'draft', to: input.to, subject: input.subject, body: input.body }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Brouillon créé dans Gmail.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur création brouillon.' } }
        }

        case 'label_email': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/gmail/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'label', id: input.message_id, label: input.label }),
            })
            const data = await safeJson(res)
            return { result: data.success ? `Label "${input.label}" appliqué.` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur label.' } }
        }

        // --- Drive extra ---
        case 'share_drive_file': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'share', id: input.file_id, email: input.email, role: input.role }),
            })
            const data = await safeJson(res)
            return { result: data.success ? `Fichier partagé avec ${data.shared_with}.` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur partage.' } }
        }

        case 'copy_drive_file': {
          try {
            const token = await getGoogleToken()
            if (!token) return { result: 'Erreur: Google non connecté.' }
            const res = await fetch('/api/drive/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ type: 'copy', id: input.file_id, name: input.new_name }),
            })
            const data = await safeJson(res)
            return { result: data.id ? `Fichier copié: "${data.name}".` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur copie.' } }
        }

        // --- WordPress (REST API) ---
        case 'wp_create_post': {
          try {
            const res = await fetch('/api/wordpress/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'create', title: input.title, content: input.content, status: input.status, date: input.date }),
            })
            const data = await safeJson(res)
            return { result: data.id ? `Article "${data.title}" créé (${data.status}).${data.link ? ` Lien: ${data.link}` : ''}` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur WordPress.' } }
        }

        case 'wp_list_posts': {
          try {
            const res = await fetch('/api/wordpress/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'list', status: input.status }),
            })
            const data = await safeJson(res)
            if (data.posts && data.posts.length > 0) {
              const list = data.posts.map((p: { id: number; title: string; status: string; date: string; link: string }, i: number) =>
                `${i + 1}. [ID:${p.id}] ${p.title} (${p.status}) — ${new Date(p.date).toLocaleDateString('fr-FR')}`
              ).join('\n')
              return { result: `${data.posts.length} articles:\n${list}` }
            }
            return { result: 'Aucun article trouvé.' }
          } catch { return { result: 'Erreur WordPress.' } }
        }

        case 'wp_update_post': {
          try {
            const res = await fetch('/api/wordpress/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'update', postId: input.post_id, title: input.title, content: input.content, status: input.status }),
            })
            const data = await safeJson(res)
            return { result: data.id ? `Article "${data.title}" modifié (${data.status}).` : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur WordPress.' } }
        }

        case 'wp_delete_post': {
          try {
            const res = await fetch('/api/wordpress/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'delete', postId: input.post_id }),
            })
            const data = await safeJson(res)
            return { result: data.success ? 'Article supprimé.' : `Erreur: ${data.error}` }
          } catch { return { result: 'Erreur WordPress.' } }
        }

        // Old Playwright-based publish (fallback)
        case 'publish_wordpress': {
          const title = input.title as string
          const content = input.content as string
          const status = (input.status as string) || 'draft'
          const res = await browserActions.publishWP({ title, content, status: status as 'draft' | 'publish' })
          if (res) {
            return { result: `Article "${title}" ${status === 'publish' ? 'publié' : 'enregistré en brouillon'}.${res.url ? ` URL: ${res.url}` : ''}` }
          }
          return { result: 'Erreur WordPress Playwright.' }
        }

        default:
          return { result: `Outil inconnu: ${name}` }
      }
    } catch (err) {
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
