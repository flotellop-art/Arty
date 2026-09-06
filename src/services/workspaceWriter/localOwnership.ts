import { HISTORY_SLOTS, type HistorySlot, type CryptoSlot } from './layout'

export class WorkspaceOwnershipError extends Error {
  constructor() { super('workspace_ownership_unsupported'); this.name = 'WorkspaceOwnershipError' }
}
const refuse = (): never => { throw new WorkspaceOwnershipError() }
export const WORKSPACE_SLOTS = [...HISTORY_SLOTS, 'crypto-salt', 'crypto-check', 'crypto-version'] as const
export type WorkspaceSlot = HistorySlot | CryptoSlot
export interface LocalOwnership { owner: string | null; kind: 'workspace' | 'setting' | 'draft'; slot: string }
export const LEGACY_SETTING_SLOTS = [
  'api-keys', 'google-tokens', 'google-tokens-enc', 'google-user', 'google-user-enc',
  'google-oauth-mailbox-free-v1', 'google-oauth-identity-bound-v2', 'google-oauth-reconsent-required',
  'email-trial-token', 'trial-remaining', 'token-usage', 'token-init-v2', 'local-memory-facts', 'custom-instructions',
  'memory-history', 'user-profile', 'streak-data', 'tasks', 'cost_history', 'cost_alert',
  'ai-model', 'reflection-level', 'fact-check-mode', 'response-style', 'theme', 'location-consent',
  'proactive-brief-enabled', 'proactive-brief-last-run', 'proactive-brief-nudge-day', 'proactive-brief-prefs',
  'notifications-enabled', 'prompt-enhancement-enabled', 'prompt-enhancement-model', 'auto-memory-enabled', 'auto-memory-progress',
] as const
export function assertOpaqueOwner(owner: unknown): asserts owner is string {
  if (typeof owner !== 'string' || !owner.length || owner.length > 128) refuse()
}
function suffixOwner(key: string, slot: string): string | null | undefined {
  if (key === `arty-${slot}`) return null
  if (!key.startsWith('arty-') || !key.endsWith(`-${slot}`)) return undefined
  const owner = key.slice(5, -slot.length - 1); assertOpaqueOwner(owner); return owner
}
export function parseLegacyWorkspaceKey(key: string): { owner: string | null; slot: WorkspaceSlot } | null {
  for (const slot of WORKSPACE_SLOTS) {
    const owner = suffixOwner(key, slot)
    if (owner !== undefined) {
      if (/^arty-(?:.*-)?report-[a-z0-9]+$/.test(key)) return refuse()
      return { owner, slot }
    }
  }
  return null
}
/** Explicitly different historical subsets. Cold proofs remain UUID-only;
 * logout also knows old ASCII conversation IDs such as conv-1. Ambiguous keys
 * return null, never an owner inferred from the first colon. */
export function parseComposerDraftOwnership(tail: string, mode: 'strict' | 'logout'): { owner: string; slot: string } | null {
  let owner: string, slot: string
  if (tail.endsWith(':home')) { owner = tail.slice(0, -5); slot = 'home' }
  else {
    const match = tail.match(mode === 'logout' ? /:conversation:([A-Za-z0-9_-]+)$/ : /:conversation:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    if (!match) return null
    owner = tail.slice(0, -match[0].length); slot = `conversation:${match[1]}`
  }
  if (!owner.length || owner.length > 128 || owner === 'anonymous' || owner.includes(':conversation:') || owner.endsWith(':conversation')) return null
  return { owner, slot }
}
/** Closed historical families, never the first '-' or ':' of an opaque owner.
 * Unknown draft/report forms and colliding interpretations refuse explicitly.
 * IDs outside the supported historical subset are NOT treated as absent. */
export function parseOwnedLocalKey(key: string): LocalOwnership | null {
  if (key.startsWith('arty-composer-draft:')) {
    const parsed = parseComposerDraftOwnership(key.slice('arty-composer-draft:'.length), 'strict')
    if (!parsed) return refuse()
    return { ...parsed, kind: 'draft' }
  }
  const workspace = parseLegacyWorkspaceKey(key)
  if (workspace) return { ...workspace, kind: 'workspace' }
  const candidates: LocalOwnership[] = []
  const slots: string[] = [...LEGACY_SETTING_SLOTS]
  const dated = key.match(/factcheck-count-\d{4}-\d{2}-\d{2}$/)?.[0]
  if (dated) slots.push(dated)
  const report = key.match(/report-(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]+)$/)?.[0]
  if (report) slots.push(report)
  for (const slot of slots) {
    const owner = suffixOwner(key, slot)
    if (owner !== undefined) candidates.push({ owner, kind: 'setting', slot })
  }
  if (candidates.length > 1) return refuse()
  if (candidates[0]) return candidates[0]
  if (/^arty-(?:.*-)?report-/.test(key)) return refuse()
  return null
}
