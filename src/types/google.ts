export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

export interface GoogleUser {
  email: string
  name: string
  picture: string
}

export interface GmailMessage {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface GmailFullMessage extends GmailMessage {
  to: string
  body: string
}

export interface EmailDraft {
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  webViewLink?: string
  iconLink?: string
}

export interface DriveFileContent extends DriveFile {
  content: string
}
