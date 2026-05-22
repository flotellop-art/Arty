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

export type AtomicConsumeOutcome =
  | { status: 'consumed'; count: number }
  | { status: 'cap_reached' }
  | { status: 'fail_open' }

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
  try {
    const query = env.DB.prepare(sql)
      .bind(...binds)
      .first<{ count: number }>()
    const timeout = new Promise<'__timeout__'>((resolve) =>
      setTimeout(() => resolve('__timeout__'), D1_QUOTA_TIMEOUT_MS)
    )
    const res = await Promise.race([query, timeout])
    if (res === '__timeout__') {
      console.error('[quota] D1 timeout sur consume, fail-open')
      return { status: 'fail_open' }
    }
    const row = res as { count: number } | null
    if (!row) return { status: 'cap_reached' }
    return { status: 'consumed', count: row.count }
  } catch (err) {
    console.error('[quota] D1 erreur sur consume, fail-open', err)
    return { status: 'fail_open' }
  }
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
