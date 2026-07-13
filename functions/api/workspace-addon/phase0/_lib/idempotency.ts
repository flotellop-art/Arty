import { Phase0Error, isRecord } from './types'

export const PHASE0_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000

const TABLE_NAME = 'workspace_addon_phase0_idempotency'
const KEY_DOMAIN = 'workspace-addon-phase0:create-draft:v1'
const MAX_KEY_PART_CHARS = 2_048
const MAX_OWNER_TOKEN_CHARS = 128
const MAX_GMAIL_ID_CHARS = 1_024

export interface Phase0IdempotencyKeyInput {
  userSub: string
  messageId: string
  nonce: string
}

export interface Phase0DraftIdentity {
  draftId: string
  threadId: string
}

export interface Phase0IdempotencyRuntime {
  now?: () => number
  randomUUID?: () => string
}

export interface Phase0IdempotencyOwner {
  status: 'owner'
  key: string
  ownerToken: string
}

export interface Phase0IdempotencyPending {
  status: 'pending'
  key: string
}

export interface Phase0IdempotencyBlocked {
  status: 'blocked'
  key: string
}

export interface Phase0IdempotencyCompleted extends Phase0DraftIdentity {
  status: 'completed'
  key: string
}

export type Phase0IdempotencyReservation =
  | Phase0IdempotencyOwner
  | Phase0IdempotencyPending
  | Phase0IdempotencyBlocked
  | Phase0IdempotencyCompleted

interface StoredReservation {
  idempotency_key: string
  owner_token: string
  status: string
  draft_id: string | null
  thread_id: string | null
  expires_at: number
}

export class Phase0IdempotencyCompletionLostError extends Phase0Error {
  constructor() {
    super('phase0_idempotency_completion_lost', { status: 409, cardSafe: true })
    this.name = 'Phase0IdempotencyCompletionLostError'
  }
}

function requireSafeString(value: unknown, maxChars: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Phase0Error('phase0_idempotency_input_invalid', { status: 400 })
  }
  return value
}

function requireNow(now: () => number): number {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Phase0Error('phase0_idempotency_clock_invalid', { status: 503 })
  }
  return value
}

function requireDatabase(db: D1Database): D1Database {
  if (!db || typeof db.prepare !== 'function') {
    throw new Phase0Error('phase0_idempotency_db_unavailable', { status: 503 })
  }
  return db
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Dérive une clé opaque sans conserver les identifiants Google en base.
 * L'encodage JSON du tuple évite les collisions de concaténation ambiguë.
 */
export async function derivePhase0IdempotencyKey(
  input: Phase0IdempotencyKeyInput,
): Promise<string> {
  const userSub = requireSafeString(input?.userSub, MAX_KEY_PART_CHARS)
  const messageId = requireSafeString(input?.messageId, MAX_KEY_PART_CHARS)
  const nonce = requireSafeString(input?.nonce, MAX_KEY_PART_CHARS)
  const material = new TextEncoder().encode(JSON.stringify([
    KEY_DOMAIN,
    userSub,
    messageId,
    nonce,
  ]))

  try {
    return bytesToHex(await crypto.subtle.digest('SHA-256', material))
  } catch {
    throw new Phase0Error('phase0_idempotency_hash_failed', { status: 503 })
  }
}

async function ensureTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      owner_token TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'blocked')),
      draft_id TEXT,
      thread_id TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      expires_at INTEGER NOT NULL,
      CHECK (
        (status = 'pending' AND draft_id IS NULL AND thread_id IS NULL AND completed_at IS NULL)
        OR
        (status = 'completed' AND draft_id IS NOT NULL AND thread_id IS NOT NULL AND completed_at IS NOT NULL)
        OR
        (status = 'blocked' AND draft_id IS NULL AND thread_id IS NULL AND completed_at IS NOT NULL)
      )
    )`,
  ).run()
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_workspace_addon_phase0_idempotency_expiry
     ON ${TABLE_NAME} (expires_at)`,
  ).run()
}

async function readReservation(db: D1Database, key: string): Promise<StoredReservation | null> {
  const row = await db.prepare(
    `SELECT idempotency_key, owner_token, status, draft_id, thread_id, expires_at
     FROM ${TABLE_NAME}
     WHERE idempotency_key = ?1`,
  ).bind(key).first<StoredReservation>()

  if (row === null) return null
  if (
    !isRecord(row)
    || row.idempotency_key !== key
    || typeof row.owner_token !== 'string'
    || typeof row.status !== 'string'
    || (row.draft_id !== null && typeof row.draft_id !== 'string')
    || (row.thread_id !== null && typeof row.thread_id !== 'string')
    || typeof row.expires_at !== 'number'
  ) {
    throw new Phase0Error('phase0_idempotency_state_invalid', { status: 503 })
  }
  return row
}

function completedReservation(row: StoredReservation): Phase0IdempotencyCompleted {
  if (
    row.status !== 'completed'
    || typeof row.draft_id !== 'string'
    || row.draft_id.length === 0
    || typeof row.thread_id !== 'string'
    || row.thread_id.length === 0
  ) {
    throw new Phase0Error('phase0_idempotency_state_invalid', { status: 503 })
  }
  return {
    status: 'completed',
    key: row.idempotency_key,
    draftId: row.draft_id,
    threadId: row.thread_id,
  }
}

/**
 * Réserve atomiquement un tuple d'action. La ligne gagnante reçoit seule le
 * jeton propriétaire ; les concurrents observent pending ou le résultat déjà
 * complété. Toute erreur D1 échoue fermée.
 */
export async function reservePhase0Idempotency(
  database: D1Database,
  input: Phase0IdempotencyKeyInput,
  runtime: Phase0IdempotencyRuntime = {},
): Promise<Phase0IdempotencyReservation> {
  const db = requireDatabase(database)
  const key = await derivePhase0IdempotencyKey(input)
  const now = requireNow(runtime.now ?? Date.now)
  const ownerToken = requireSafeString(
    (runtime.randomUUID ?? (() => crypto.randomUUID()))(),
    MAX_OWNER_TOKEN_CHARS,
  )

  try {
    await ensureTable(db)
    // Après 24 h, les identifiants du résultat sont expurgés mais la clé reste
    // une tombe permanente. Un vieux bouton Gmail ne peut donc jamais redevenir
    // owner. Les états pending incertains ne sont jamais libérés sans une
    // réconciliation explicite.
    await db.prepare(
      `UPDATE ${TABLE_NAME}
       SET status = 'blocked', owner_token = '', draft_id = NULL, thread_id = NULL
       WHERE status = 'completed' AND expires_at <= ?1`,
    ).bind(now).run()

    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO ${TABLE_NAME}
        (idempotency_key, owner_token, status, draft_id, thread_id, created_at, completed_at, expires_at)
       VALUES (?1, ?2, 'pending', NULL, NULL, ?3, NULL, ?4)
       RETURNING idempotency_key`,
    ).bind(key, ownerToken, now, now + PHASE0_IDEMPOTENCY_TTL_MS)
      .first<{ idempotency_key: string }>()

    if (inserted?.idempotency_key === key) {
      return { status: 'owner', key, ownerToken }
    }

    const existing = await readReservation(db, key)
    if (!existing) {
      throw new Phase0Error('phase0_idempotency_state_unavailable', { status: 503 })
    }
    if (existing.status === 'completed') return completedReservation(existing)
    if (existing.status === 'pending') return { status: 'pending', key }
    if (existing.status === 'blocked') return { status: 'blocked', key }
    throw new Phase0Error('phase0_idempotency_state_invalid', { status: 503 })
  } catch (caught) {
    if (caught instanceof Phase0Error) throw caught
    throw new Phase0Error('phase0_idempotency_reserve_failed', { status: 503 })
  }
}

/**
 * Finalise uniquement la réservation propriétaire encore valide. Un échec ne
 * supprime jamais la ligne pending : un retry de reserve reste bloqué jusqu'à
 * une réconciliation explicite, ce qui évite de recréer un brouillon après un
 * résultat Gmail incertain.
 */
export async function completePhase0Idempotency(
  database: D1Database,
  owner: Phase0IdempotencyOwner,
  draft: Phase0DraftIdentity,
  runtime: Pick<Phase0IdempotencyRuntime, 'now'> = {},
): Promise<Phase0IdempotencyCompleted> {
  const db = requireDatabase(database)
  const key = requireSafeString(owner?.key, 64)
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw new Phase0Error('phase0_idempotency_input_invalid', { status: 400 })
  }
  const ownerToken = requireSafeString(owner?.ownerToken, MAX_OWNER_TOKEN_CHARS)
  const draftId = requireSafeString(draft?.draftId, MAX_GMAIL_ID_CHARS)
  const threadId = requireSafeString(draft?.threadId, MAX_GMAIL_ID_CHARS)
  const now = requireNow(runtime.now ?? Date.now)

  try {
    await ensureTable(db)
    let updated: { idempotency_key: string } | null = null
    let updateFailed = false
    try {
      updated = await db.prepare(
        `UPDATE ${TABLE_NAME}
         SET status = 'completed', draft_id = ?1, thread_id = ?2, completed_at = ?3
         WHERE idempotency_key = ?4
           AND owner_token = ?5
           AND status = 'pending'
           AND expires_at > ?3
         RETURNING idempotency_key`,
      ).bind(draftId, threadId, now, key, ownerToken)
        .first<{ idempotency_key: string }>()
    } catch {
      // Une erreur de transport peut survenir après le commit D1. La lecture
      // ci-dessous tranche sans jamais refaire l'UPDATE ni libérer la ligne.
      updateFailed = true
    }

    if (updated?.idempotency_key === key) {
      return { status: 'completed', key, draftId, threadId }
    }

    // Rend complete idempotent pour le propriétaire lorsque D1 a commité mais
    // que la réponse de l'UPDATE s'est perdue. Aucun autre état n'est écrasé.
    const existing = await readReservation(db, key)
    if (
      existing?.status === 'completed'
      && existing.owner_token === ownerToken
      && existing.draft_id === draftId
      && existing.thread_id === threadId
    ) {
      return completedReservation(existing)
    }
    if (updateFailed) {
      throw new Phase0Error('phase0_idempotency_complete_failed', { status: 503 })
    }
    throw new Phase0IdempotencyCompletionLostError()
  } catch (caught) {
    if (caught instanceof Phase0IdempotencyCompletionLostError) throw caught
    if (caught instanceof Phase0Error) throw caught
    throw new Phase0Error('phase0_idempotency_complete_failed', { status: 503 })
  }
}
