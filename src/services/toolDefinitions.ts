import { computerToolDefinitions } from './tools/computerTools'
import { gmailToolDefinitions } from './tools/gmailTools'
import { driveToolDefinitions } from './tools/driveTools'
import { calendarToolDefinitions } from './tools/calendarTools'
import { contactsToolDefinitions } from './tools/contactsTools'
import { wordpressToolDefinitions } from './tools/wordpressTools'
import { utilityToolDefinitions } from './tools/utilityTools'

export const TOOLS = [
  ...utilityToolDefinitions,
  ...computerToolDefinitions,
  ...gmailToolDefinitions,
  ...driveToolDefinitions,
  ...calendarToolDefinitions,
  ...contactsToolDefinitions,
  ...wordpressToolDefinitions,
  // Server-side tools (handled by Anthropic API, no local executor)
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as any,
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  } as any,
]
