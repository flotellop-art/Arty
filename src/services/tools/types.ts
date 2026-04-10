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

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>
