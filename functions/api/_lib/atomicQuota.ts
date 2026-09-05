import type { Env } from '../../env'

// ─────────────────────────────────────────────────────────────────────
// Compteurs de quota atomiques (D1)
//
// Cloudflare KV n'a pas de compare-and-set : le pattern get→check→put est
// vulnérable aux courses concurrentes (2 requêtes simultanées, voire 2 POPs
// avec KV eventually-consistent, peuvent dépasser le quota). D1 (SQLite,
// primaire unique) sérialise les écritures → un upsert conditionnel est
// atomique et ne dépasse JAMAIS le cap.
//
// Pattern de référence déjà éprouvé dans quota.ts (consumeDailyQuota).
// ─────────────────────────────────────────────────────────────────────

// Timeout sur le hot path des proxys IA. Si D1 ne répond pas sous ce délai,
// on fail-open (laisse passer) pour ne jamais bloquer un user sur un incident
// infra — cohérent avec quota.ts ("Never block on infra failure"). Le timeout
// borne la latence ajoutée par la dépendance D1.
const D1_QUOTA_TIMEOUT_MS = 250

type SettledConsumeOutcome =
  | { status: 'consumed'; count: number }
  | { status: 'cap_reached' }
  | { status: 'fail_open' }

export type AtomicConsumeOutcome =
  | Exclude<SettledConsumeOutcome, { status: 'fail_open' }>
  | { status: 'fail_open'; pending?: Promise<SettledConsumeOutcome> }

export type QuotaWaitUntil = (promise: Promise<unknown>) => void

/**
 * Consomme atomiquement un compteur cappé via un upsert conditionnel D1.
 *
 * Le SQL DOIT être de la forme :
 *   INSERT INTO <table> (..., count, ...) VALUES (..., 1, ...)
 *   ON CONFLICT (...) DO UPDATE SET count = count + 1, ...
 *     WHERE <table>.count < ?<capParam>
 *   RETURNING count
 *
 * (pour le compteur trial, aliaser la colonne : `RETURNING used AS count`).
 *
 * Atomicité : SQLite/D1 exécute l'instruction sous un write-lock global sur la
 * primary. Deux requêtes concurrentes à count=cap-1 → l'une obtient cap (passe),
 * l'autre voit le WHERE faux → UPDATE skip → RETURNING ne renvoie aucune ligne
 * → cap_reached. Le compteur ne dépasse jamais le cap. Au 1er appel l'INSERT
 * crée la ligne à count=1 et RETURNING la renvoie.
 *
 * IMPORTANT : ne JAMAIS router ce binding via l'API Sessions read-replica —
 * le RETURNING doit lire la primary, sinon l'atomicité saute.
 *
 * Fail-open sur erreur OU timeout : retourne 'fail_open' ; le caller décide de
 * laisser passer.
 */
export async function consumeCapAtomic(
  env: Env,
  sql: string,
  binds: ReadonlyArray<string | number>
): Promise<AtomicConsumeOutcome> {
  if (!env.DB) return { status: 'fail_open' }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const query = env.DB.prepare(sql)
      .bind(...binds)
      .first<{ count: number }>()
      .then<SettledConsumeOutcome, SettledConsumeOutcome>(
        (row) => row ? { status: 'consumed', count: row.count } : { status: 'cap_reached' },
        (err) => {
          console.error('[quota] D1 erreur sur consume, fail-open', err)
          return { status: 'fail_open' }
        },
      )
    const timeout = new Promise<'__timeout__'>((resolve) => {
      timer = setTimeout(() => resolve('__timeout__'), D1_QUOTA_TIMEOUT_MS)
    })
    const res = await Promise.race([query, timeout])
    if (res === '__timeout__') {
      console.error('[quota] D1 timeout sur consume, fail-open')
      // A timeout does not cancel the write. Keep THIS query's final result;
      // refundable callers must not infer a debit or replay the UPSERT.
      return { status: 'fail_open', pending: query }
    }
    return res
  } catch (err) {
    console.error('[quota] D1 erreur sur consume, fail-open', err)
    return { status: 'fail_open' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Trial policy: timeout means uncharged, even if the upstream succeeds.
 * Register compensation before returning; only a confirmed late debit can be
 * refunded. No retry on an ambiguous D1 failure. waitUntil/refund remain
 * best-effort, not a durable journal. Other caps keep their existing policy.
 * Without a background lifetime, wait for the actual result (no latency bound).
 */
export async function consumeRefundableCapAtomic(
  env: Env,
  sql: string,
  binds: ReadonlyArray<string | number>,
  refund: () => Promise<void>,
  waitUntil?: QuotaWaitUntil,
): Promise<SettledConsumeOutcome> {
  const outcome = await consumeCapAtomic(env, sql, binds)
  if (outcome.status !== 'fail_open' || !outcome.pending) return outcome
  if (!waitUntil) return outcome.pending
  const compensation = outcome.pending.then(async (late) => {
    if (late.status === 'consumed') await refund()
  })
  try {
    waitUntil(compensation)
  } catch {
    // The same promise is drained, never recreated or refunded twice.
    await compensation
  }
  return { status: 'fail_open' }
}

/**
 * Nettoyage paresseux des lignes périmées. D1 n'a pas de TTL comme KV : sans
 * ça les tables de compteurs grossiraient indéfiniment. On purge ~1 appel sur
 * 50 (probabiliste) pour amortir le coût — les compteurs périmés (jour/mois
 * passé) n'ont aucune valeur. Best-effort, jamais bloquant.
 */
export async function maybeCleanup(
  env: Env,
  sql: string,
  binds: ReadonlyArray<string | number>,
  probability = 0.02
): Promise<void> {
  if (!env.DB || Math.random() >= probability) return
  try {
    await env.DB.prepare(sql)
      .bind(...binds)
      .run()
  } catch (err) {
    console.error('[quota] cleanup ignoré (non bloquant)', err)
  }
}
