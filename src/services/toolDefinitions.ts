import { computerToolDefinitions } from './tools/computerTools'
import { gmailToolDefinitions } from './tools/gmailTools'
import { driveToolDefinitions } from './tools/driveTools'
import { calendarToolDefinitions } from './tools/calendarTools'
import { contactsToolDefinitions } from './tools/contactsTools'
import { wordpressToolDefinitions } from './tools/wordpressTools'
import { utilityToolDefinitions } from './tools/utilityTools'
import { nativeToolDefinitions } from './tools/nativeTools'
import { sheetsToolDefinitions } from './tools/sheetsTools'
import { ENABLE_RESTRICTED_GOOGLE_FEATURES } from '../config'

const filteredGmailTools = ENABLE_RESTRICTED_GOOGLE_FEATURES
  ? gmailToolDefinitions
  : gmailToolDefinitions.filter((t) => t.name === 'send_email')

export const TOOLS = [
  ...utilityToolDefinitions,
  ...computerToolDefinitions,
  ...filteredGmailTools,
  ...(ENABLE_RESTRICTED_GOOGLE_FEATURES ? driveToolDefinitions : []),
  ...calendarToolDefinitions,
  ...contactsToolDefinitions,
  ...wordpressToolDefinitions,
  ...nativeToolDefinitions,
  ...(ENABLE_RESTRICTED_GOOGLE_FEATURES ? sheetsToolDefinitions : []),
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
