export interface ToolResult {
  result: string
  screenshot?: string
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>
