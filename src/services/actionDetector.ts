import type { useBrowser } from '../hooks/useBrowser'
import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'

interface ActionResult {
  handled: boolean
  context?: string
}

export async function detectAndRunAction(
  text: string,
  computer: ReturnType<typeof useComputer>,
  browserActions: ReturnType<typeof useBrowser>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
): Promise<ActionResult> {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // --- Computer Use: open app ---
  const openMatch = lower.match(/ouvr[eir]+ (excel|word|chrome|navigateur|bloc-notes|notepad|calculatrice|paint|explorateur)/)
  if (openMatch) {
    const app = openMatch[1]!
    const result = await computer.openApp(app)
    if (result?.success && result.screenshot) {
      return {
        handled: true,
        context: `[Action exécutée] J'ai ouvert ${app} sur le PC. Voici un screenshot de l'écran.\n\n![Screenshot PC](${result.screenshot})`,
      }
    }
    return {
      handled: true,
      context: `[Action échouée] Impossible d'ouvrir ${app} : ${result?.error || 'PC non joignable. Vérifiez que start-all.bat est lancé.'}`,
    }
  }

  // --- Computer Use: screenshot ---
  if (lower.includes('screenshot') || lower.includes('capture') && (lower.includes('ecran') || lower.includes('pc'))) {
    const result = await computer.screenshot()
    if (result?.success && result.screenshot) {
      return {
        handled: true,
        context: `[Action exécutée] Voici le screenshot de l'écran du PC.\n\n![Screenshot PC](${result.screenshot})`,
      }
    }
    return {
      handled: true,
      context: `[Action échouée] Impossible de capturer l'écran : ${result?.error || 'PC non joignable.'}`,
    }
  }

  // --- Gmail: read emails ---
  if (lower.includes('email') && (lower.includes('lire') || lower.includes('lis') || lower.includes('mes email') || lower.includes('boite'))) {
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

  // --- Drive: search files ---
  if (lower.includes('drive') || (lower.includes('fichier') && (lower.includes('cherch') || lower.includes('trouv') || lower.includes('list')))) {
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
        : '[Erreur] Impossible d\'accéder à Drive. Vérifiez la connexion Google.',
    }
  }

  // --- Browser: price search ---
  if (lower.includes('prix') && (lower.includes('cherch') || lower.includes('compar') || lower.includes('fournisseur'))) {
    // Extract product name from the message
    const product = text.replace(/.*prix\s*(de|du|des|pour)?\s*/i, '').trim()
    if (product) {
      const result = await browserActions.searchPrices(product)
      if (result) {
        const table = result.results.map(r => `| ${r.source} | ${r.product} | ${r.price} |`).join('\n')
        return {
          handled: true,
          context: `[Recherche prix] Résultats pour "${result.query}" :\n\n| Fournisseur | Produit | Prix |\n|---|---|---|\n${table}`,
        }
      }
    }
  }

  return { handled: false }
}
