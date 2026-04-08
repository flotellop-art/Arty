export type ComputerAction =
  | 'screenshot'
  | 'open_app'
  | 'click'
  | 'type'
  | 'scroll'
  | 'key'

export interface ComputerActionRequest {
  action: ComputerAction
  params?: Record<string, unknown>
}

export interface ComputerActionResponse {
  success: boolean
  action: string
  screenshot?: string
  error?: string
  [key: string]: unknown
}
