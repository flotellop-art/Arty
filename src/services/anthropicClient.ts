import { SYSTEM_PROMPT } from '../constants/systemPrompt'
import { addUsage } from './tokenTracker'

const TOOLS = [
  // --- Reports ---
  {
    name: 'generate_report',
    description: "Génère un rapport HTML professionnel ouvert dans le navigateur. UTILISE CET OUTIL quand l'utilisateur demande un rapport, un devis, une analyse, un document structuré.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Titre du rapport' },
        content: { type: 'string' as const, description: 'Contenu HTML (utilise: card, card-accent, card-dark, chapter, big-number, subtitle, badge-*, grid-2, grid-3, table, alert-*, divider-accent, progress-bar, stat, etc.)' },
      },
      required: ['title', 'content'],
    },
  },
  // --- PC Control ---
  {
    name: 'open_app',
    description: "Ouvre une application sur le PC de l'utilisateur (quand le PC est allumé).",
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
    description: "Prend un screenshot de l'écran du PC.",
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
    description: 'Obtenir la météo actuelle et prévisions 5 jours.',
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
          description: 'Liste des postes au format JSON: [{"label":"Prestation","surface":120,"price_per_m2":45},...]',
        },
        tva_rate: { type: 'number' as const, description: 'Taux TVA en % (10 ou 20)' },
        client_name: { type: 'string' as const, description: 'Nom du client' },
      },
      required: ['items', 'tva_rate'],
    },
  },
  {
    name: 'calculate_surface',
    description: 'Calcule une surface (largeur × hauteur - ouvertures).',
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
  // --- Questions interactives ---
  {
    name: 'ask_user',
    description: "Pose des questions à l'utilisateur via un formulaire interactif (modal étape par étape). Utilise-le quand tu as besoin de 2+ infos pour avancer. Chaque question apparaît une par une avec des options cliquables.",
    input_schema: {
      type: 'object' as const,
      properties: {
        questions: {
          type: 'array' as const,
          description: 'Liste des questions à poser',
          items: {
            type: 'object' as const,
            properties: {
              question: { type: 'string' as const, description: 'La question à poser' },
              options: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Options de réponse cliquables (optionnel)',
              },
              allow_free_text: {
                type: 'boolean' as const,
                description: 'Autoriser la saisie libre en plus des options (défaut: true)',
              },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
  },
  // --- Mémoire persistante ---
  {
    name: 'update_memory',
    description: "Met à jour la mémoire persistante. Catégories : profil (préférences utilisateur), clients (fiches clients), chantiers (historique chantiers), notes (infos diverses). Envoie le JSON COMPLET de la catégorie (pas un diff).",
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string' as const,
          enum: ['profil', 'clients', 'chantiers', 'notes'],
          description: 'Catégorie à mettre à jour',
        },
        data: {
          description: 'Données complètes (JSON). Pour clients/chantiers: tableau. Pour profil: objet. Pour notes: tableau de strings.',
        },
      },
      required: ['category', 'data'],
    },
  },
  // --- Outils serveur Anthropic (exécutés côté API, zéro backend) ---
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as any,
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  } as any,
  // code_execution is auto-injected by the API when web_search or web_fetch are present
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

function formatApiError(status: number, body: string): string {
  // Try to extract a clean message from the JSON error body
  try {
    const parsed = JSON.parse(body)
    const errorType = parsed?.error?.type
    if (errorType === 'overloaded_error') {
      return 'Le serveur IA est temporairement surchargé. Réessai automatique...'
    }
    if (errorType === 'rate_limit_error') {
      return 'Trop de requêtes envoyées. Patiente quelques secondes...'
    }
    if (errorType === 'authentication_error') {
      return 'Clé API invalide ou expirée. Vérifie ta configuration.'
    }
    if (errorType === 'invalid_request_error') {
      return `Requête invalide : ${parsed?.error?.message || 'vérifie le format du message.'}`
    }
    if (parsed?.error?.message) {
      return parsed.error.message
    }
  } catch {
    // Not JSON, use status-based message
  }

  switch (status) {
    case 401: return 'Clé API invalide. Vérifie ta configuration.'
    case 403: return 'Accès refusé à l\'API.'
    case 429: return 'Trop de requêtes. Patiente quelques secondes...'
    case 500: return 'Erreur serveur chez Anthropic. Réessaie dans un instant.'
    case 529: return 'Le serveur IA est temporairement surchargé. Réessai automatique...'
    default: return `Erreur de connexion (${status}). Vérifie ta connexion internet.`
  }
}

async function fetchWithRetry(
  requestBody: string,
  apiKey: string,
  controller: AbortController
): Promise<Response> {
  let response: Response | null = null
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: requestBody,
      signal: controller.signal,
    })

    const isRetryable = response.status === 429 || response.status === 529 || response.status >= 500
    if (response.ok || !isRetryable || attempt === maxRetries) {
      break
    }

    // Exponential backoff: 2s, 4s, 8s
    const delay = Math.pow(2, attempt + 1) * 1000
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  if (!response!.ok) {
    const body = await response!.text().catch(() => '')
    throw new Error(formatApiError(response!.status, body))
  }

  return response!
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseSSEStream(
  response: Response,
  onToken: (text: string) => void,
  _controller: AbortController
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ contentBlocks: any[]; inputTokens: number; outputTokens: number }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = []
  let currentToolInput = ''
  let currentBlockType = ''
  let currentTextContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let buffer = ''
  let eventType = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
          continue
        }

        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6)
        if (jsonStr === '[DONE]') continue

        let data
        try {
          data = JSON.parse(jsonStr)
        } catch {
          continue
        }

        switch (eventType) {
          case 'message_start':
            if (data.message?.usage) {
              inputTokens = data.message.usage.input_tokens || 0
            }
            break

          case 'content_block_start':
            if (data.content_block?.type === 'text') {
              currentBlockType = 'text'
              currentTextContent = ''
            } else if (data.content_block?.type === 'tool_use') {
              currentBlockType = 'tool_use'
              currentToolInput = ''
              contentBlocks.push({
                type: 'tool_use',
                id: data.content_block.id,
                name: data.content_block.name,
                input: {},
              })
            } else if (data.content_block?.type === 'server_tool_use') {
              // Server-side tool (web_search, web_fetch, code_execution) — handled by Anthropic
              currentBlockType = 'server_tool_use'
            } else if (data.content_block?.type === 'web_search_tool_result' ||
                       data.content_block?.type === 'web_fetch_tool_result' ||
                       data.content_block?.type === 'code_execution_tool_result') {
              // Server tool results — Claude uses them internally, skip in stream
              currentBlockType = 'server_tool_result'
            }
            break

          case 'content_block_delta':
            if (data.delta?.type === 'text_delta' && data.delta.text) {
              onToken(data.delta.text)
              currentTextContent += data.delta.text
            } else if (data.delta?.type === 'input_json_delta' && data.delta.partial_json) {
              currentToolInput += data.delta.partial_json
            }
            break

          case 'content_block_stop':
            if (currentBlockType === 'text' && currentTextContent) {
              contentBlocks.push({ type: 'text', text: currentTextContent })
            } else if (currentBlockType === 'tool_use' && currentToolInput) {
              const lastTool = contentBlocks[contentBlocks.length - 1]
              if (lastTool?.type === 'tool_use') {
                try {
                  lastTool.input = JSON.parse(currentToolInput)
                } catch {
                  lastTool.input = {}
                }
              }
            }
            currentBlockType = ''
            break

          case 'message_delta':
            if (data.usage) {
              outputTokens = data.usage.output_tokens || 0
            }
            break

          case 'error':
            throw new Error(data.error?.message || 'Erreur streaming')
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { contentBlocks, inputTokens, outputTokens }
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

    let maxIterations = 15
    while (maxIterations > 0) {
      maxIterations--

      const requestBody = JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 65536,
        temperature: 0.7,
        stream: true,
        system: options?.systemPrompt || SYSTEM_PROMPT,
        tools: TOOLS,
        messages: apiMessages,
      })

      const response = await fetchWithRetry(requestBody, apiKey, controller)
      const { contentBlocks, inputTokens, outputTokens } = await parseSSEStream(
        response,
        onToken,
        controller
      )

      // Track token usage
      addUsage(inputTokens, outputTokens)

      const hasToolUse = contentBlocks.some((b) => b.type === 'tool_use')

      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      // Execute tool calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = []
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          const toolResult = await options.onToolCall(block.name, block.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult.result,
          })
        }
      }

      apiMessages.push({ role: 'assistant', content: contentBlocks })
      apiMessages.push({ role: 'user', content: toolResults })
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
