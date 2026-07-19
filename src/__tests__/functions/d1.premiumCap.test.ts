// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { checkPremiumCap } from '../../../functions/api/_lib/checkPremiumCap'
import type { Env } from '../../../functions/env'

// Zone 1 (C8/F-5) — consumeCapAtomic via checkPremiumCap : l'upsert conditionnel
// D1 ne dépasse JAMAIS le cap, même sous appels concurrents (le pattern KV
// get→check→put, lui, le pouvait). On utilise le bucket image (cap 10) pour
// tester la concurrence à moindre coût.
const IMG = 'gpt-image-1'        // bucket 'gpt-image', cap 10
const STD = 'claude-haiku-4-5'   // standard, jamais cappé

let h: D1Harness
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
beforeEach(async () => { await h.reset() })

describe('checkPremiumCap — cap atomique (zone 1)', () => {
  it('un modèle standard passe sans consommer de cap', async () => {
    const r = await checkPremiumCap('std@x.io', STD, h.env)
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe('standard_model')
    const row = await h.db.prepare('SELECT COUNT(*) AS n FROM premium_cap').first<{ n: number }>()
    expect(row!.n).toBe(0) // aucun compteur créé pour un modèle standard
  })

  it('décrémente le restant et expose bucket + cap', async () => {
    const r = await checkPremiumCap('u1@x.io', IMG, h.env)
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe('monthly_cap')
    expect(r.debited).toEqual({ kind: 'monthly_cap', month: expect.any(String) })
    expect(r.bucket).toBe('gpt-image')
    expect(r.cap).toBe(10)
    expect(r.remaining).toBe(9)
  })

  it('consommation SÉQUENTIELLE : la garde WHERE count<cap plafonne exactement au cap', async () => {
    // Preuve DÉTERMINISTE de la garde conditionnelle (pas de fail_open possible
    // hors concurrence, D1 in-memory répond en <1ms) : cap appels consommés avec
    // un restant qui décroît, puis refus net.
    const email = 'seq@x.io'
    const cap = 10
    for (let i = 0; i < cap; i++) {
      const r = await checkPremiumCap(email, IMG, h.env)
      expect(r.allowed).toBe(true)
      expect(r.reason).toBe('monthly_cap')
      expect(r.remaining).toBe(cap - 1 - i)
    }
    const over = await checkPremiumCap(email, IMG, h.env)
    expect(over.allowed).toBe(false)
    expect(over.reason).toBe('cap_reached')
    const row = await h.db.prepare('SELECT count FROM premium_cap WHERE email=?1').bind(email).first<{ count: number }>()
    expect(row!.count).toBe(cap)
  })

  it('appels CONCURRENTS : le compteur D1 ne dépasse jamais le cap', async () => {
    // Le harnais Miniflare est mono-writer (SQLite sérialise les écritures) : ce
    // test ne prouve PAS l'atomicité sous course matérielle réelle (impossible en
    // in-memory), mais il vérifie l'invariant de NON-DÉPASSEMENT sous charge —
    // la garde `WHERE count < cap` n'est jamais franchie, même quand une part des
    // appels part en fail_open (timeout 250ms non annulable). L'assertion robuste
    // est donc `<= cap` (une écriture différée peut committer après le read).
    const email = 'race@x.io'
    const cap = 10
    const results = await Promise.all(
      Array.from({ length: cap * 3 }, () => checkPremiumCap(email, IMG, h.env)),
    )
    const row = await h.db
      .prepare('SELECT count FROM premium_cap WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(row!.count).toBeLessThanOrEqual(cap) // JAMAIS de dépassement
    // Aucun restant négatif (overspend) sur les réponses réellement consommées.
    for (const r of results) {
      if (typeof r.remaining === 'number') expect(r.remaining).toBeGreaterThanOrEqual(0)
    }
    // Saturation atteinte : au moins un refus cap_reached.
    expect(results.some((r) => r.reason === 'cap_reached')).toBe(true)
  })

  it("n'annonce aucun débit remboursable lors d'un fail-open D1", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = {
      prepare(sql: string) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS premium_cap')) {
          return { run: async () => ({ success: true }) }
        }
        if (sql.includes('INSERT INTO premium_cap')) {
          return {
            bind: () => ({ first: async () => { throw new Error('D1 unavailable') } }),
          }
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }

    const r = await checkPremiumCap(
      'fail-open@x.io',
      IMG,
      { DB: db } as unknown as Env,
    )

    expect(r).toMatchObject({ allowed: true, reason: 'monthly_cap' })
    expect(r.debited).toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})

// ── Zone remboursement (revue C3, 18/07/2026) ────────────────────────────────
// Invariant : « quota/cap consommé ⟺ message servi ». Le retry d'éligibilité
// du client (Terra rejeté → gpt-5) refait une requête complète : sans void,
// un seul message consommait 2 unités du bucket. Ces tests figent le
// remboursement sur les 3 chemins (monthly_cap, premium_pack, quota journalier).
import { voidPremiumCap } from '../../../functions/api/_lib/checkPremiumCap'
import { consumeDailyQuota, voidDailyQuota } from '../../../functions/api/_lib/quota'

describe('voidPremiumCap — remboursement du cap (revue C3)', () => {
  it('rembourse une consommation monthly_cap et la rend re-consommable', async () => {
    const email = 'refund@x.io'
    const r1 = await checkPremiumCap(email, IMG, h.env)
    expect(r1.reason).toBe('monthly_cap')
    expect(r1.remaining).toBe(9)

    await voidPremiumCap(h.env, email, r1)
    const row = await h.db
      .prepare('SELECT count FROM premium_cap WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(row!.count).toBe(0)

    // L'unité rendue est bien re-consommable (pas juste un compteur cosmétique).
    const r2 = await checkPremiumCap(email, IMG, h.env)
    expect(r2.remaining).toBe(9)
  })

  it('ne descend jamais sous 0 (double void = no-op)', async () => {
    const email = 'floor@x.io'
    const r = await checkPremiumCap(email, IMG, h.env)
    await voidPremiumCap(h.env, email, r)
    await voidPremiumCap(h.env, email, r)
    const row = await h.db
      .prepare('SELECT count FROM premium_cap WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(row!.count).toBe(0)
  })

  it('no-op pour un résultat standard_model (aucune ligne créée)', async () => {
    const email = 'std-void@x.io'
    const r = await checkPremiumCap(email, STD, h.env)
    await voidPremiumCap(h.env, email, r)
    const row = await h.db.prepare('SELECT COUNT(*) AS n FROM premium_cap').first<{ n: number }>()
    expect(row!.n).toBe(0)
  })

  it('ne rembourse jamais un résultat sans débit confirmé', async () => {
    const email = 'unconfirmed@x.io'
    const consumed = await checkPremiumCap(email, IMG, h.env)
    const { debited: _debited, ...unconfirmed } = consumed

    await voidPremiumCap(h.env, email, unconfirmed)

    const row = await h.db
      .prepare('SELECT count FROM premium_cap WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(row!.count).toBe(1)
  })

  it('rembourse le mois capturé sans toucher le compteur du mois suivant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const email = 'month-boundary@x.io'

    vi.setSystemTime(new Date('2026-06-30T23:59:59.900Z'))
    const june = await checkPremiumCap(email, IMG, h.env)
    expect(june.debited).toEqual({ kind: 'monthly_cap', month: '2026-06' })

    vi.setSystemTime(new Date('2026-07-01T00:00:00.100Z'))
    const july = await checkPremiumCap(email, IMG, h.env)
    expect(july.debited).toEqual({ kind: 'monthly_cap', month: '2026-07' })

    await voidPremiumCap(h.env, email, june)

    const rows = await h.db
      .prepare('SELECT month, count FROM premium_cap WHERE email = ?1 ORDER BY month')
      .bind(email)
      .all<{ month: string; count: number }>()
    expect(rows.results).toEqual([
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 1 },
    ])
  })

  it('re-crédite un pack entamé (reason premium_pack)', async () => {
    const email = 'pack@x.io'
    await h.db
      .prepare(
        `INSERT INTO premium_packs (user_email, ls_order_id, messages_total, messages_used)
         VALUES (?1, 'order-1', 100, 5)`
      )
      .bind(email)
      .run()
    await voidPremiumCap(h.env, email, {
      allowed: true,
      debited: { kind: 'premium_pack' },
      reason: 'premium_pack',
      bucket: 'gpt-image',
      cap: 10,
    })
    const row = await h.db
      .prepare('SELECT messages_used FROM premium_packs WHERE user_email = ?1')
      .bind(email)
      .first<{ messages_used: number }>()
    expect(row!.messages_used).toBe(4)
  })
})

describe('voidDailyQuota — remboursement du quota journalier (revue C3)', () => {
  it("n'annonce aucun débit remboursable si D1 est absent ou échoue avant l'UPSERT", async () => {
    const missing = await consumeDailyQuota({} as Env, 'missing@x.io', 'gpt-5.6-terra')
    expect(missing.debited).toBeUndefined()

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failingDb = {
      prepare() {
        throw new Error('D1 unavailable')
      },
    }
    const failed = await consumeDailyQuota(
      { DB: failingDb } as unknown as Env,
      'failed@x.io',
      'gpt-5.6-terra',
    )
    expect(failed.debited).toBeUndefined()
    expect(error).toHaveBeenCalled()
  })

  it("expose seulement le débit global si D1 échoue avant l'UPSERT modèle", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const partialDb = {
      prepare(sql: string) {
        if (sql.includes('INSERT INTO quota ')) {
          return {
            bind: () => ({ first: async () => ({ count: 1 }) }),
          }
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS quota_model')) {
          return { run: async () => { throw new Error('D1 partial failure') } }
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }

    const result = await consumeDailyQuota(
      { DB: partialDb } as unknown as Env,
      'partial@x.io',
      'gpt-5.6-terra',
    )

    expect(result).toMatchObject({ allowed: true, count: 0 })
    expect(result.debited).toEqual({
      day: expect.any(String),
      global: true,
      model: false,
    })
    expect(error).toHaveBeenCalled()
  })

  it('rembourse les DEUX tables (quota + quota_model), jamais sous 0', async () => {
    const email = 'daily@x.io'
    const model = 'gpt-5.6-terra'
    const consumed = await consumeDailyQuota(h.env, email, model)
    expect(consumed.debited).toEqual({
      day: expect.any(String),
      global: true,
      model: true,
    })
    if (!consumed.debited) throw new Error('Expected confirmed quota debit')
    await voidDailyQuota(h.env, email, model, consumed.debited)

    const g = await h.db
      .prepare('SELECT count FROM quota WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    const m = await h.db
      .prepare('SELECT count FROM quota_model WHERE email = ?1 AND model = ?2')
      .bind(email, model)
      .first<{ count: number }>()
    expect(g!.count).toBe(0)
    expect(m!.count).toBe(0)

    await voidDailyQuota(h.env, email, model, consumed.debited)
    const g2 = await h.db
      .prepare('SELECT count FROM quota WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(g2!.count).toBe(0)
  })

  it('ne rembourse que le compteur dont le débit a été confirmé', async () => {
    const email = 'partial-daily@x.io'
    const model = 'gpt-5.6-terra'
    await consumeDailyQuota(h.env, email, model)

    await voidDailyQuota(h.env, email, model, {
      day: new Date().toISOString().slice(0, 10),
      global: true,
      model: false,
    })

    const g = await h.db
      .prepare('SELECT count FROM quota WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    const m = await h.db
      .prepare('SELECT count FROM quota_model WHERE email = ?1 AND model = ?2')
      .bind(email, model)
      .first<{ count: number }>()
    expect(g!.count).toBe(0)
    expect(m!.count).toBe(1)
  })

  it('rembourse le jour capturé sans toucher les compteurs du lendemain', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const email = 'day-boundary@x.io'
    const model = 'gpt-5.6-terra'

    vi.setSystemTime(new Date('2026-07-19T23:59:59.900Z'))
    const previousDay = await consumeDailyQuota(h.env, email, model)
    expect(previousDay.debited).toEqual({
      day: '2026-07-19',
      global: true,
      model: true,
    })

    vi.setSystemTime(new Date('2026-07-20T00:00:00.100Z'))
    const nextDay = await consumeDailyQuota(h.env, email, model)
    expect(nextDay.debited).toEqual({
      day: '2026-07-20',
      global: true,
      model: true,
    })
    if (!previousDay.debited) throw new Error('Expected confirmed quota debit')

    await voidDailyQuota(h.env, email, model, previousDay.debited)

    const globalRows = await h.db
      .prepare('SELECT day, count FROM quota WHERE email = ?1 ORDER BY day')
      .bind(email)
      .all<{ day: string; count: number }>()
    const modelRows = await h.db
      .prepare('SELECT day, count FROM quota_model WHERE email = ?1 AND model = ?2 ORDER BY day')
      .bind(email, model)
      .all<{ day: string; count: number }>()
    expect(globalRows.results).toEqual([
      { day: '2026-07-19', count: 0 },
      { day: '2026-07-20', count: 1 },
    ])
    expect(modelRows.results).toEqual([
      { day: '2026-07-19', count: 0 },
      { day: '2026-07-20', count: 1 },
    ])
  })
})
