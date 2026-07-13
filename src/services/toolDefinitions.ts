import { computerToolDefinitions } from './tools/computerTools'
import { gmailToolDefinitions } from './tools/gmailTools'
import { driveToolDefinitions } from './tools/driveTools'
import { calendarToolDefinitions } from './tools/calendarTools'
import { contactsToolDefinitions } from './tools/contactsTools'
import { wordpressToolDefinitions } from './tools/wordpressTools'
import { utilityToolDefinitions } from './tools/utilityTools'
import { nativeToolDefinitions } from './tools/nativeTools'
import { sheetsToolDefinitions } from './tools/sheetsTools'
import { isGmailNoCasaPhase0Enabled } from './gmailNoCasaPhase0'

export function buildToolDefinitions(noCasa = isGmailNoCasaPhase0Enabled()) {
  return [
  ...utilityToolDefinitions,
  ...computerToolDefinitions,
  ...(noCasa ? [] : gmailToolDefinitions),
  ...(noCasa ? [] : driveToolDefinitions),
  ...calendarToolDefinitions,
  ...(noCasa ? [] : contactsToolDefinitions),
  ...wordpressToolDefinitions,
  ...nativeToolDefinitions,
  ...sheetsToolDefinitions,
  // Server-side tools (handled by Anthropic API, no local executor)
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as any,
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    allowed_callers: ['direct'],
  } as any,
  ]
}

export const TOOLS = buildToolDefinitions()
