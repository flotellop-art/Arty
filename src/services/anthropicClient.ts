import { SYSTEM_PROMPT } from '../constants/systemPrompt'
import { addUsage } from './tokenTracker'

const TOOLS = [
  // --- PC Control ---
  {
    name: 'open_app',
    description: "Ouvre une application sur le PC de Florent (quand le PC est allumé).",
    input_schema: {
      type: 'object' as const,
      properties: {
        app: {
          type: 'string' as const,
          enum: ['excel', 'word', 'chrome', 'navigateur', 'wordpress', 'bloc-notes', 'notepad', 'calculatrice', 'paint', 'explorateur'],
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'screenshot_pc',
    description: "Prend un screenshot de l'écran du PC de Florent.",
    input_schema: { type: 'object' as const, properties: {} },
  },
  // --- Gmail ---
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
    name: 'send_email',
    description: "Envoie un email. TOUJOURS demander confirmation à Florent avant d'envoyer.",
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
    description: "Répond à un email existant. TOUJOURS demander confirmation à Florent.",
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
  // --- Google Drive ---
  {
    name: 'list_drive',
    description: 'Liste les fichiers récents sur Google Drive.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'search_drive',
    description: 'Cherche un fichier par nom sur Google Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Nom ou mot-clé à chercher' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_drive_file',
    description: "Lit le contenu d'un fichier Drive (PDF, Doc, texte, tableur).",
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const, description: 'ID du fichier' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'create_drive_file',
    description: 'Crée un nouveau document sur Google Drive (Google Doc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Nom du fichier' },
        content: { type: 'string' as const, description: 'Contenu du document' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'delete_drive_file',
    description: 'Supprime un fichier de Google Drive. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { file_id: { type: 'string' as const } },
      required: ['file_id'],
    },
  },
  {
    name: 'rename_drive_file',
    description: 'Renomme un fichier sur Google Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        new_name: { type: 'string' as const },
      },
      required: ['file_id', 'new_name'],
    },
  },
  {
    name: 'move_drive_file',
    description: 'Déplace un fichier dans un dossier Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        folder_id: { type: 'string' as const, description: 'ID du dossier destination' },
      },
      required: ['file_id', 'folder_id'],
    },
  },
  {
    name: 'create_drive_folder',
    description: 'Crée un dossier sur Google Drive (pour organiser par client/chantier).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        parent_id: { type: 'string' as const, description: 'ID du dossier parent (optionnel)' },
      },
      required: ['name'],
    },
  },
  // --- Google Calendar ---
  {
    name: 'list_calendar',
    description: 'Voir les RDV et événements du calendrier Google (par défaut : 7 prochains jours).',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, description: 'Nombre de jours à afficher (défaut 7)' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Créer un RDV dans Google Calendar (chantier, réunion, relance client).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: "Titre de l'événement" },
        start: { type: 'string' as const, description: 'Date/heure début (ISO 8601, ex: 2026-04-15T09:00:00)' },
        end: { type: 'string' as const, description: 'Date/heure fin (optionnel)' },
        location: { type: 'string' as const, description: 'Lieu (adresse du chantier, etc.)' },
        description: { type: 'string' as const, description: 'Notes' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'update_calendar_event',
    description: 'Modifier un événement du calendrier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string' as const },
        title: { type: 'string' as const },
        start: { type: 'string' as const },
        end: { type: 'string' as const },
        location: { type: 'string' as const },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Supprimer un événement du calendrier. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { event_id: { type: 'string' as const } },
      required: ['event_id'],
    },
  },
  // --- Google Contacts ---
  {
    name: 'search_contacts',
    description: 'Chercher un contact client par nom.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' as const } },
      required: ['query'],
    },
  },
  {
    name: 'create_contact',
    description: 'Ajouter un nouveau contact client.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        email: { type: 'string' as const },
        phone: { type: 'string' as const },
        company: { type: 'string' as const },
      },
      required: ['name'],
    },
  },
  // --- Gmail avancé ---
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
      properties: {
        message_id: { type: 'string' as const },
      },
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
  // --- Météo ---
  {
    name: 'get_weather',
    description: 'Obtenir la météo actuelle et prévisions 5 jours. Utile pour planifier les chantiers façade (pas de travail sous la pluie).',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string' as const, description: 'Ville (défaut: Valence)' },
      },
    },
  },
  // --- Utilitaires ---
  {
    name: 'calculate_quote',
    description: 'Calcule un chiffrage/devis. Surface × tarif + TVA.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'string' as const,
          description: 'Liste des postes au format JSON: [{"label":"Enduit gratté","surface":120,"price_per_m2":45},...]',
        },
        tva_rate: { type: 'number' as const, description: 'Taux TVA en % (10 ou 20)' },
        client_name: { type: 'string' as const, description: 'Nom du client' },
      },
      required: ['items', 'tva_rate'],
    },
  },
  {
    name: 'calculate_surface',
    description: 'Calcule la surface de façade (largeur × hauteur - ouvertures).',
    input_schema: {
      type: 'object' as const,
      properties: {
        walls: { type: 'string' as const, description: 'Murs JSON: [{"width":10,"height":3},...]' },
        openings: { type: 'string' as const, description: 'Ouvertures JSON: [{"width":1.2,"height":1.5,"count":3},...]' },
      },
      required: ['walls'],
    },
  },
  {
    name: 'calculate_distance',
    description: 'Calcule la distance et le temps de trajet depuis Valence vers une adresse de chantier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string' as const, description: 'Adresse de destination' },
      },
      required: ['destination'],
    },
  },
  // --- Web ---
  {
    name: 'web_search',
    description: 'Recherche sur internet (DuckDuckGo). Pour trouver des infos, prix, actualités.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Requête de recherche' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_price',
    description: 'Recherche prix chez fournisseurs BTP (Point P, Gedimat).',
    input_schema: {
      type: 'object' as const,
      properties: {
        product: { type: 'string' as const, description: 'Produit à chercher' },
      },
      required: ['product'],
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
  {
    name: 'share_drive_file',
    description: 'Partage un fichier Drive avec une adresse email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        email: { type: 'string' as const },
        role: { type: 'string' as const, enum: ['reader', 'writer', 'commenter'] },
      },
      required: ['file_id', 'email'],
    },
  },
  {
    name: 'copy_drive_file',
    description: 'Copie un fichier Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        new_name: { type: 'string' as const },
      },
      required: ['file_id'],
    },
  },
  // --- WordPress ---
  {
    name: 'wp_create_post',
    description: "Crée un article WordPress (brouillon ou publié). CONFIRMATION OBLIGATOIRE pour publier.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const },
        content: { type: 'string' as const, description: 'Contenu HTML' },
        status: { type: 'string' as const, enum: ['draft', 'publish', 'future'] },
        date: { type: 'string' as const, description: 'Date de publication programmée (ISO 8601)' },
      },
      required: ['title', 'content', 'status'],
    },
  },
  {
    name: 'wp_list_posts',
    description: 'Liste les articles WordPress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' as const, enum: ['publish', 'draft', 'any'] },
      },
    },
  },
  {
    name: 'wp_update_post',
    description: 'Modifie un article WordPress existant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        post_id: { type: 'number' as const },
        title: { type: 'string' as const },
        content: { type: 'string' as const },
        status: { type: 'string' as const, enum: ['draft', 'publish'] },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'wp_delete_post',
    description: 'Supprime un article WordPress. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { post_id: { type: 'number' as const } },
      required: ['post_id'],
    },
  },
]

type ToolHandler = (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>

interface StreamOptions {
  systemPrompt?: string
  onToolCall?: ToolHandler
}

export function streamMessage(
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: StreamOptions
): AbortController {
  const controller = new AbortController()

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    setTimeout(() => onError(new Error('Clé API manquante')), 0)
    return controller
  }

  runWithTools(apiKey, messages, onToken, onDone, onError, options, controller)
  return controller
}

async function runWithTools(
  apiKey: string,
  originalMessages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options: StreamOptions | undefined,
  controller: AbortController
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiMessages: any[] = originalMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    let maxIterations = 5
    while (maxIterations > 0) {
      maxIterations--

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: options?.systemPrompt || SYSTEM_PROMPT,
          tools: TOOLS,
          messages: apiMessages,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Erreur API (${response.status}): ${body}`)
      }

      const data = await response.json()

      // Track token usage
      if (data.usage) {
        addUsage(data.usage.input_tokens || 0, data.usage.output_tokens || 0)
      }

      let hasToolUse = false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = []

      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          onToken(block.text)
        }
        if (block.type === 'tool_use') {
          hasToolUse = true
        }
      }

      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      for (const block of data.content) {
        if (block.type === 'tool_use') {
          const toolResult = await options.onToolCall(block.name, block.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult.result,
          })
        }
      }

      apiMessages.push({ role: 'assistant', content: data.content })
      apiMessages.push({ role: 'user', content: toolResults })
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
