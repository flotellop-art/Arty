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
  /** Vrai si le contenu a été tronqué côté serveur (note visible dans `content`). */
  truncated?: boolean
  /** Longueur du contenu avant troncature. */
  originalLength?: number
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  location: string
  description: string
  htmlLink?: string
}

export interface CalendarEventDraft {
  title: string
  start: string
  end?: string
  location?: string
  description?: string
}

export interface Contact {
  resourceName: string
  name: string
  email: string
  phone: string
  company: string
}

export interface ContactDraft {
  name: string
  email?: string
  phone?: string
  company?: string
}
