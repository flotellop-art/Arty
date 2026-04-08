import { SYSTEM_PROMPT } from '../constants/systemPrompt'

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'open_app',
    description: "Ouvre une application sur le PC de Florent. Utilise cette action quand Florent demande d'ouvrir un logiciel ou un site.",
    input_schema: {
      type: 'object' as const,
      properties: {
        app: {
          type: 'string' as const,
          enum: ['excel', 'word', 'chrome', 'navigateur', 'wordpress', 'bloc-notes', 'notepad', 'calculatrice', 'paint', 'explorateur'],
          description: "Nom de l'application à ouvrir",
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'screenshot_pc',
    description: "Prend un screenshot de l'écran du PC de Florent. Utilise quand il veut voir son écran ou vérifier quelque chose.",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'read_emails',
    description: 'Lit les 10 derniers emails non lus de Gmail de Florent.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_drive',
    description: 'Liste les fichiers récents sur Google Drive de Florent.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'search_price',
    description: 'Recherche les prix chez les fournisseurs BTP (Point P, Gedimat).',
    input_schema: {
      type: 'object' as const,
      properties: {
        product: {
          type: 'string' as const,
          description: 'Nom du produit à rechercher',
        },
      },
      required: ['product'],
    },
  },
  {
    name: 'read_drive_file',
    description: "Lit le contenu d'un fichier sur Google Drive (PDF, Google Doc, texte, tableur). Utilise l'ID du fichier obtenu via list_drive.",
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const, description: 'ID du fichier Google Drive' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'publish_wordpress',
    description: "Publie un article sur le site facadespollet.fr. Utilise quand Florent demande de créer/publier un article. Rédige d'abord le contenu complet puis publie.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: "Titre de l'article" },
        content: { type: 'string' as const, description: "Contenu HTML de l'article" },
        status: { type: 'string' as const, enum: ['draft', 'publish'], description: 'Brouillon ou publication directe' },
      },
      required: ['title', 'content', 'status'],
    },
  },
  {
    name: 'click_on_pc',
    description: 'Clique à des coordonnées précises sur l\'écran du PC. Utilise après un screenshot pour interagir.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' as const, description: 'Coordonnée X' },
        y: { type: 'number' as const, description: 'Coordonnée Y' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'type_on_pc',
    description: 'Tape du texte sur le PC de Florent dans l\'application active.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' as const, description: 'Texte à taper' },
      },
      required: ['text'],
    },
  },
]

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface StreamOptions {
  systemPrompt?: string
  image?: string
  onToolCall?: (name: string, input: Record<string, unknown>) => Promise<{ result: string; screenshot?: string }>
}

export function streamMessage(
  messages: ApiMessage[],
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

  const apiMessages = messages.map((m, i) => {
    if (options?.image && i === messages.length - 1 && m.role === 'user') {
      const base64Data = options.image.replace(/^data:image\/\w+;base64,/, '')
      return {
        role: m.role,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: base64Data } },
          { type: 'text' as const, text: typeof m.content === 'string' ? m.content : '' },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })

  doStream(apiKey, apiMessages, options, onToken, onDone, onError, controller)
  return controller
}

async function doStream(
  apiKey: string,
  messages: ApiMessage[],
  options: StreamOptions | undefined,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  controller: AbortController
) {
  try {
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
        stream: false,
        system: options?.systemPrompt || SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Erreur API (${response.status}): ${body}`)
    }

    const data = await response.json()

    // Collect text and ALL tool_use blocks
    let textContent = ''
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push({ id: block.id, name: block.name, input: block.input })
      }
    }

    if (textContent) {
      onToken(textContent)
    }

    // Execute ALL tool calls and send results
    if (toolUseBlocks.length > 0 && options?.onToolCall) {
      const toolResults: ContentBlock[] = []

      for (const tool of toolUseBlocks) {
        const toolResult = await options.onToolCall(tool.name, tool.input)

        if (toolResult.screenshot) {
          const base64Data = toolResult.screenshot.replace(/^data:image\/\w+;base64,/, '')
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: tool.id,
            content: [
              { type: 'text', text: toolResult.result },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Data } },
            ],
          } as unknown as ContentBlock)
        } else {
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: tool.id,
            content: toolResult.result,
          } as unknown as ContentBlock)
        }
      }

      const newMessages: ApiMessage[] = [
        ...messages,
        { role: 'assistant' as const, content: data.content },
        { role: 'user' as const, content: toolResults },
      ]

      await doStream(apiKey, newMessages, { ...options, image: undefined }, onToken, onDone, onError, controller)
      return
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
