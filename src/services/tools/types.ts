export interface FileData {
  name: string
  mimeType: string
  base64: string
}

export interface ToolResult {
  result: string
  screenshot?: string
  fileData?: FileData
}

/** Local authority, never taken from tool arguments or sent to a provider. */
export interface ToolExecutionContext {
  imageGeneration?: { readonly signal: AbortSignal; assertCurrent(): void }
}

export type ToolHandler = (input: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>
export type ToolDispatcher = (name: string, input: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>
