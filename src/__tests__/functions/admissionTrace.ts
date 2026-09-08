// Test-only observer, bundled unchanged for the Node/workerd comparison.
// No injected delays, retries or altered handles. Log only after settlement.
export function traceAdmission(db: D1Database) {
  const start = performance.now()
  const events: { event: string; at: number; detail?: unknown }[] = []
  const pending: Promise<unknown>[] = []
  const background: Promise<unknown>[] = []
  const now = () => performance.now() - start
  const mark = (event: string, detail?: unknown) => events.push({ event, at: now(), detail })
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout
  let nextTimer = 0
  const handles = new Map<ReturnType<typeof setTimeout>, number>()
  globalThis.setTimeout = function (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) {
    if (ms !== 250) return Reflect.apply(set, globalThis, [callback, ms, ...args])
    const id = ++nextTimer
    mark('timer.schedule', { id, ms })
    const handle = Reflect.apply(set, globalThis, [function (this: unknown, ...values: unknown[]) {
      mark('timer.fire', { id })
      return Reflect.apply(callback, this, values)
    }, ms, ...args])
    handles.set(handle, id)
    return handle
  } as typeof setTimeout
  globalThis.clearTimeout = function (handle?: ReturnType<typeof setTimeout>) {
    if (handle !== undefined && handles.has(handle)) mark('timer.clear', { id: handles.get(handle) })
    return Reflect.apply(clear, globalThis, [handle])
  } as typeof clearTimeout

  function statement(target: D1PreparedStatement, sql: string): D1PreparedStatement {
    return new Proxy(target, { get(stmt, key) {
      if (key === 'bind') return (...args: unknown[]) => {
        mark('bind.start', { sql })
        try { return statement(stmt.bind(...args), sql) }
        finally { mark('bind.end', { sql }) }
      }
      const method = Reflect.get(stmt, key)
      if (typeof method !== 'function') return method
      if (!['first', 'run', 'all', 'raw'].includes(String(key))) return method.bind(stmt)
      return (...args: unknown[]) => {
        mark('sql.start', { sql, method: String(key) })
        let task: Promise<unknown>
        try { task = Promise.resolve(Reflect.apply(method, stmt, args)) }
        catch (error) { mark('sql.throw', { sql, error: String(error) }); throw error }
        const observed = task.then(value => {
          mark('sql.resolve', { sql, value }); return value
        }, error => { mark('sql.reject', { sql, error: String(error) }); throw error })
        pending.push(observed)
        return observed
      }
    } })
  }
  const tracedDb = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => {
      const normalized = sql.trim().replace(/\s+/g, ' ')
      mark('prepare.start', { sql: normalized })
      try { return statement(target.prepare(sql), normalized) }
      finally { mark('prepare.end', { sql: normalized }) }
    }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return {
    db: tracedDb, events, mark,
    waitUntil(task: Promise<unknown>) { mark('background.register'); background.push(task) },
    async drain() {
      const settledBackground = await Promise.allSettled(background)
      mark('background.settled', settledBackground.map(result => result.status === 'fulfilled' ? 'fulfilled' : String(result.reason)))
      const operations: PromiseSettledResult<unknown>[] = []
      for (let offset = 0; offset < pending.length;) {
        const batch = pending.slice(offset); offset = pending.length
        operations.push(...await Promise.allSettled(batch))
      }
      return { rejectedBackground: settledBackground.filter(result => result.status === 'rejected').map(result => String(result.reason)),
        rejectedSql: operations.filter(result => result.status === 'rejected').map(result => String(result.reason)) }
    },
    restore() { globalThis.setTimeout = set; globalThis.clearTimeout = clear },
  }
}

export async function admissionFinancialState(db: D1Database) {
  return {
    trial: await db.prepare('SELECT used,updated_at FROM trial_usage').first(),
    wallet: await db.prepare('SELECT balance_micro,reserved_micro FROM wallet').first(),
    holds: (await db.prepare('SELECT id FROM reservation').all()).results,
    tickets: (await db.prepare('SELECT id FROM subsidized_attempt_v1').all()).results,
    emailTrial: (await db.prepare('SELECT used FROM email_trial_usage').all()).results,
  }
}
