import { SYSTEM_PROMPT } from '../constants/systemPrompt'

const TOOLS = [
  {
    name: 'open_app',
    description: "Ouvre une application sur le PC de Florent.",
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
  {
    name: 'read_emails',
    description: 'Lit les derniers emails non lus de Gmail.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_drive',
    description: 'Liste les fichiers sur Google Drive.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'read_drive_file',
    description: "Lit le contenu d'un fichier Drive (PDF, Doc, texte).",
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const, description: 'ID du fichier' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'search_price',
    description: 'Recherche prix chez fournisseurs BTP.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product: { type: 'string' as const, description: 'Produit à chercher' },
      },
      required: ['product'],
    },
  },
  {
    name: 'publish_wordpress',
    description: "Publie un article sur facadespollet.fr.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const },
        content: { type: 'string' as const },
        status: { type: 'string' as const, enum: ['draft', 'publish'] },
      },
      required: ['title', 'content', 'status'],
    },
  },
  {
    name: 'click_on_pc',
    description: "Clique à des coordonnées sur l'écran du PC.",
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' as const },
        y: { type: 'number' as const },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'type_on_pc',
    description: "Tape du texte sur le PC.",
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' as const },
      },
      required: ['text'],
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
    // Build API messages (only text content from conversation history)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiMessages: any[] = originalMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // Loop: call API, handle tools, repeat until no more tools
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

      // Extract text and tool calls
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

      // If no tool calls, we're done
      if (!hasToolUse || !options?.onToolCall) {
        onDone()
        return
      }

      // Execute all tool calls
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

      // Append assistant response + tool results for next iteration
      apiMessages.push({ role: 'assistant', content: data.content })
      apiMessages.push({ role: 'user', content: toolResults })
    }

    // Max iterations reached
    onDone()
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err)
    }
  }
}
