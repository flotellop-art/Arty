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
    switch (name) {
      case 'open_app': {
        const app = (input.app as string) || ''
        const res = await computer.openApp(app)
        if (res?.success) {
          return { result: `${app} ouvert avec succès.`, screenshot: res.screenshot }
        }
        return { result: `Erreur: ${res?.error || 'PC non joignable'}` }
      }

      case 'screenshot_pc': {
        const res = await computer.screenshot()
        if (res?.success) {
          return { result: 'Screenshot capturé.', screenshot: res.screenshot }
        }
        return { result: `Erreur: ${res?.error || 'PC non joignable'}` }
      }

      case 'click_on_pc': {
        const x = input.x as number
        const y = input.y as number
        const res = await computer.click(x, y)
        if (res?.success) {
          return { result: `Clic effectué à (${x}, ${y}).`, screenshot: res.screenshot }
        }
        return { result: `Erreur: ${res?.error || 'PC non joignable'}` }
      }

      case 'type_on_pc': {
        const text = input.text as string
        const res = await computer.type(text)
        if (res?.success) {
          return { result: `Texte tapé: "${text}"`, screenshot: res.screenshot }
        }
        return { result: `Erreur: ${res?.error || 'PC non joignable'}` }
      }

      case 'read_emails': {
        const messages = await gmail.fetchMessages()
        if (messages && messages.length > 0) {
          const summary = messages.slice(0, 10).map((m, i) =>
            `${i + 1}. De: ${m.from} | Objet: ${m.subject} | ${m.snippet}`
          ).join('\n')
          return { result: `${messages.length} emails non lus:\n${summary}` }
        }
        return { result: messages?.length === 0 ? 'Aucun email non lu.' : 'Erreur Gmail.' }
      }

      case 'list_drive': {
        const files = await drive.fetchFiles()
        if (files && files.length > 0) {
          const summary = files.slice(0, 20).map((f, i) =>
            `${i + 1}. ${f.name} (${f.mimeType.split('.').pop()})`
          ).join('\n')
          return { result: `${files.length} fichiers:\n${summary}` }
        }
        return { result: files?.length === 0 ? 'Aucun fichier.' : 'Erreur Drive.' }
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
        return { result: 'Erreur recherche prix.' }
      }

      case 'publish_wordpress': {
        const title = input.title as string
        const content = input.content as string
        const status = (input.status as string) || 'draft'
        const res = await browserActions.publishWP({ title, content, status: status as 'draft' | 'publish' })
        if (res) {
          return { result: `Article "${title}" ${status === 'publish' ? 'publié' : 'enregistré en brouillon'} sur WordPress.${res.url ? ` URL: ${res.url}` : ''}` }
        }
        return { result: 'Erreur publication WordPress.' }
      }

      default:
        return { result: `Action inconnue: ${name}` }
    }
  }
}
