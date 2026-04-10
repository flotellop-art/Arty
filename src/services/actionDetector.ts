import { getAnthropicKey } from './activeApiKey'
import type { useBrowser } from '../hooks/useBrowser'
import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

interface ActionResult {
  handled: boolean
  context?: string
  screenshot?: string
}

interface IntentResponse {
  action: string
  params?: Record<string, string>
}

let _actionDetectorApiKey: string | undefined

export function setActionDetectorApiKey(key: string) {
  _actionDetectorApiKey = key
}

async function detectIntent(text: string): Promise<IntentResponse> {
  const apiKey = _actionDetectorApiKey || getAnthropicKey()
  if (!apiKey) return { action: 'none' }

  const prompt = `Tu es un détecteur d'intention. Analyse le message utilisateur et retourne UNIQUEMENT un JSON (pas de texte autour).

Actions possibles :
- {"action":"open_app","params":{"app":"excel|word|chrome|navigateur|bloc-notes|notepad|calculatrice|paint|explorateur|wordpress"}}
- {"action":"screenshot_pc"}
- {"action":"read_emails"}
- {"action":"list_drive"}
- {"action":"search_price","params":{"product":"nom du produit"}}
- {"action":"create_article"}
- {"action":"none"}

Règles :
- "ouvre/lance/démarre/mets [app]" → open_app
- "wordpress/wp/admin du site/blog" → open_app avec app=wordpress
- "screenshot/capture/écran du pc/montre l'écran" → screenshot_pc
- "emails/mails/courrier/boîte de réception" → read_emails
- "drive/fichiers/documents google" → list_drive
- "prix/tarif/coût chez fournisseur/combien coûte" → search_price
- "article/publier/publication/blog/rédiger pour le site" → create_article
- Sinon → none

Message: "${text.replace(/"/g, '\\"')}"

JSON:`

  try {
    const res = await fetch(apiUrl('/api/ai/proxy'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) return { action: 'none' }

    const data = await safeJson(res)
    const text_response = (data.content as Array<{text?: string}>)?.[0]?.text || ''
    const jsonMatch = text_response.match(/\{[^}]+\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return { action: 'none' }
  } catch {
    return { action: 'none' }
  }
}

export async function detectAndRunAction(
  text: string,
  computer: ReturnType<typeof useComputer>,
  browserActions: ReturnType<typeof useBrowser>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
): Promise<ActionResult> {
  const intent = await detectIntent(text)

  switch (intent.action) {
    case 'open_app': {
      const app = intent.params?.app || ''
      if (!app) return { handled: false }
      const result = await computer.openApp(app)
      if (result?.success) {
        return {
          handled: true,
          context: `[Action exécutée avec succès] ${app} a été ouvert sur le PC. Un screenshot de l'écran est affiché ci-dessous. Confirme que c'est fait.`,
          screenshot: result.screenshot,
        }
      }
      return {
        handled: true,
        context: `[Action échouée] Impossible d'ouvrir ${app} : ${result?.error || 'PC non joignable.'}`,
      }
    }

    case 'screenshot_pc': {
      const result = await computer.screenshot()
      if (result?.success) {
        return {
          handled: true,
          context: `[Action exécutée avec succès] Screenshot de l'écran du PC capturé et affiché ci-dessous.`,
          screenshot: result.screenshot,
        }
      }
      return {
        handled: true,
        context: `[Action échouée] Impossible de capturer l'écran : ${result?.error || 'PC non joignable.'}`,
      }
    }

    case 'read_emails': {
      const messages = await gmail.fetchMessages()
      if (messages && messages.length > 0) {
        const summary = messages.slice(0, 10).map((m, i) =>
          `${i + 1}. **${m.from}** — ${m.subject}\n   _${m.snippet}_`
        ).join('\n\n')
        return {
          handled: true,
          context: `[Emails récupérés] ${messages.length} emails non lus :\n\n${summary}`,
        }
      }
      return {
        handled: true,
        context: messages && messages.length === 0
          ? '[Emails récupérés] Aucun email non lu.'
          : '[Erreur] Impossible de lire les emails. Vérifiez la connexion Google.',
      }
    }

    case 'list_drive': {
      const files = await drive.fetchFiles()
      if (files && files.length > 0) {
        const summary = files.slice(0, 15).map((f, i) =>
          `${i + 1}. **${f.name}** (${f.mimeType.split('.').pop() || f.mimeType})`
        ).join('\n')
        return {
          handled: true,
          context: `[Google Drive] ${files.length} fichiers trouvés :\n\n${summary}`,
        }
      }
      return {
        handled: true,
        context: files && files.length === 0
          ? '[Google Drive] Aucun fichier trouvé.'
          : '[Erreur] Impossible d\'accéder à Drive.',
      }
    }

    case 'search_price': {
      const product = intent.params?.product || ''
      if (!product) return { handled: false }
      const result = await browserActions.searchPrices(product)
      if (result) {
        const table = result.results.map(r => `| ${r.source} | ${r.product} | ${r.price} |`).join('\n')
        return {
          handled: true,
          context: `[Recherche prix] Résultats pour "${result.query}" :\n\n| Fournisseur | Produit | Prix |\n|---|---|---|\n${table}`,
        }
      }
      return { handled: false }
    }

    case 'create_article': {
      return {
        handled: true,
        context: `[WordPress disponible] L'utilisateur veut créer ou publier un article. Demande-lui le titre et le contenu. Propose-lui de rédiger l'article.`,
      }
    }

    default:
      return { handled: false }
  }
}
