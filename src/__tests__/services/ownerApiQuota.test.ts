import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
  OWNER_API_DAILY_LIMITS,
} from '../../../functions/api/_lib/freeQuota'

// maybeCleanup() dépend de Math.random (~2% de chance d'un DELETE). On le force
// au-dessus du seuil pour rendre les tests déterministes (cleanup toujours skip).
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(1)
})
afterEach(() => {
  vi.restoreAllMocks()
})

// Mock D1 minimal : prepare().run() (ensureFreeTable) + prepare().bind().first()
// (consumeCapAtomic). `capture` récupère les binds du RETURNING pour vérifier
// le montant consommé.
function mockEnv(
  firstResult: { count: number } | null,
  capture?: { binds?: unknown[] }
): { DB: unknown } {
  return {
    DB: {
      prepare(sql: string) {
        return {
          run: async () => ({}),
          bind(...binds: unknown[]) {
            return {
              first: async () => {
                if (capture && sql.includes('free_daily_quota') && sql.includes('RETURNING')) {
                  capture.binds = binds
                }
                return firstResult
              },
              run: async () => ({}),
            }
          },
        }
      },
    },
  }
}

describe('planSubjectToOwnerApiCap', () => {
  it('plafonne les plans non-payants (free, trial)', () => {
    expect(planSubjectToOwnerApiCap('free')).toBe(true)
    expect(planSubjectToOwnerApiCap('trial')).toBe(true)
  })
  it('exempte les plans payants (subscription, pro, vip)', () => {
    expect(planSubjectToOwnerApiCap('subscription')).toBe(false)
    expect(planSubjectToOwnerApiCap('pro')).toBe(false)
    expect(planSubjectToOwnerApiCap('vip')).toBe(false)
  })
})

describe('consumeOwnerApiQuota', () => {
  it('fail-open si pas de binding D1 (incident infra ne bloque pas)', async () => {
    const res = await consumeOwnerApiQuota({} as never, 'a@b.c', 'web-search')
    expect(res.allowed).toBe(true)
    expect(res.limit).toBe(OWNER_API_DAILY_LIMITS['web-search'])
  })

  it('autorise sous le cap et calcule le restant', async () => {
    const env = mockEnv({ count: 3 }) as never
    const res = await consumeOwnerApiQuota(env, 'a@b.c', 'web-search')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(OWNER_API_DAILY_LIMITS['web-search'] - 3)
  })

  it('refuse quand le cap est atteint (aucune ligne renvoyée)', async () => {
    const env = mockEnv(null) as never
    const res = await consumeOwnerApiQuota(env, 'a@b.c', 'geo-reverse')
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
  })

  it('consomme `amount` unités (multi-source = 1 par source, pas 1 par requête)', async () => {
    const capture: { binds?: unknown[] } = {}
    const env = mockEnv({ count: 6 }, capture) as never
    await consumeOwnerApiQuota(env, 'a@b.c', 'web-search', 6)
    // binds : [email, day, family, n, limit]
    expect(capture.binds?.[3]).toBe(6)
    expect(capture.binds?.[4]).toBe(OWNER_API_DAILY_LIMITS['web-search'])
  })

  it('borne `amount` à >= 1 (jamais 0 ni négatif)', async () => {
    const capture: { binds?: unknown[] } = {}
    const env = mockEnv({ count: 1 }, capture) as never
    await consumeOwnerApiQuota(env, 'a@b.c', 'url-fetch', 0)
    expect(capture.binds?.[3]).toBe(1)
  })
})

describe('ownerApiLimitResponse', () => {
  it('renvoie un 429 générique sans détail provider', async () => {
    const res = ownerApiLimitResponse('web-search', 50)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; limit: number }
    expect(body.error).toBe('daily_limit_reached')
    expect(body.limit).toBe(50)
  })
})
