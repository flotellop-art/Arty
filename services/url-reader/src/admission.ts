export const GLOBAL_DAILY_READS = 100
export const USER_DAILY_READS = 20
export const MAX_CONCURRENT_READS = 2
type Lease = { createdAt: number; sessionId?: string }
type Ledger = { day: string; count: number; users: Record<string, number>; leases: Record<string, Lease> }

/** One singleton DO serializes admission across POPs and all subscription plans.
 * Attempts stay consumed even on refusal/timeout; no retry or speculative refund. */
export class ReaderAdmission {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    let body: { subject?: unknown; release?: unknown; inspect?: unknown; attach?: unknown; sessionId?: unknown }
    try { body = await request.json() } catch { return Response.json({ allowed: false }, { status: 400 }) }
    return this.state.storage.transaction(async store => {
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10)
      const saved = await store.get<Ledger>('ledger')
      // Keep live leases across UTC midnight; quotas reset, concurrency does not.
      const ledger: Ledger = saved?.day === day ? saved : {
        day, count: 0, users: {}, leases: saved?.leases ?? {},
      }
      // No timed release: an expired timer does not attest a remote browser closed.
      // A crashed/uncertain run keeps its slot until operator reconciliation.
      if (body.inspect === true) return Response.json({ leases: ledger.leases })
      if (typeof body.attach === 'string' && typeof body.sessionId === 'string'
        && /^[a-f0-9-]{36}$/.test(body.sessionId) && ledger.leases[body.attach]) {
        ledger.leases[body.attach].sessionId = body.sessionId
        await store.put('ledger', ledger)
        return Response.json({ attached: true })
      }
      if (typeof body.release === 'string') {
        delete ledger.leases[body.release]
        await store.put('ledger', ledger)
        return Response.json({ released: true })
      }
      if (typeof body.subject !== 'string' || !/^[a-f0-9]{64}$/.test(body.subject)) {
        return Response.json({ allowed: false }, { status: 400 })
      }
      if (ledger.count >= GLOBAL_DAILY_READS || (ledger.users[body.subject] ?? 0) >= USER_DAILY_READS) {
        return Response.json({ allowed: false, reason: 'daily_limit' }, { status: 429 })
      }
      if (Object.keys(ledger.leases).length >= MAX_CONCURRENT_READS) {
        return Response.json({ allowed: false, reason: 'busy' }, { status: 429 })
      }
      const lease = crypto.randomUUID()
      ledger.count++
      ledger.users[body.subject] = (ledger.users[body.subject] ?? 0) + 1
      ledger.leases[lease] = { createdAt: now }
      await store.put('ledger', ledger)
      return Response.json({ allowed: true, lease })
    })
  }
}
