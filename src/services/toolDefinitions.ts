import { computerToolDefinitions } from './tools/computerTools'
import { calendarToolDefinitions } from './tools/calendarTools'
import { wordpressToolDefinitions } from './tools/wordpressTools'
import { utilityToolDefinitions } from './tools/utilityTools'
import { nativeToolDefinitions } from './tools/nativeTools'
import { trailToolDefinitions } from './tools/trailTools'

export function buildToolDefinitions() {
  return [
  ...utilityToolDefinitions,
  ...trailToolDefinitions,
  ...computerToolDefinitions,
  ...calendarToolDefinitions,
  ...wordpressToolDefinitions,
  ...nativeToolDefinitions,
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
