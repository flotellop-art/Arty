/**
 * Convert Anthropic-format tool definitions to OpenAI-format (used by Mistral).
 * Anthropic: { name, description, input_schema: { type, properties, required } }
 * OpenAI:    { type: 'function', function: { name, description, parameters: { type, properties, required } } }
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnthropicTool = { name: string; description?: string; input_schema?: any; type?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAITool = { type: 'function'; function: { name: string; description: string; parameters: any } }

export function convertToolsToOpenAI(anthropicTools: AnthropicTool[]): OpenAITool[] {
  return anthropicTools
    .filter(t => t.input_schema && t.description) // Skip server-side tools (web_search, web_fetch)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description!,
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }))
}
