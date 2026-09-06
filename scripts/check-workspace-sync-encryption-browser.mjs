// Synthetic codec probe only, NOT the Arty application, outbox or cloud sync.
// Requires Playwright + installed Chrome. No production account/data/network.
// ARTY_PLAYWRIGHT_MODULE can point to an already installed Playwright package.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.ARTY_PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ configFile: false, logLevel: 'error', appType: 'custom',
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } })
server.middlewares.use((req, res, next) => {
  if (req.url !== '/__sync-probe.html') return next()
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic sync codec probe</title>')
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ channel: process.env.ARTY_BROWSER_CHANNEL || 'chrome', headless: true })
  const unexpectedNetwork = [], pageErrors = []
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })])
  for (const context of contexts) await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(route.request().method())) {
      unexpectedNetwork.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort()
    }
    return route.continue()
  })
  const run = async (context, phase, transferred = null) => {
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      await page.goto(`${origin}/__sync-probe.html`)
      return await page.evaluate(async ({ phase, transferred }) => {
        const E = await import('/src/services/workspaceSync/encryption.ts')
        const { stageSyncChange } = await import('/src/services/workspaceSync/causal.ts')
        const check = (condition, message) => { if (!condition) throw new Error(message) }
        const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
        const scope = { vaultId: id(1), epoch: id(2) }
        const base = { format: 'arty-sync-causal', version: 1, ...scope, records: [] }
        const recovery = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
        const sha = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('')
        const life = new AbortController(), session = E.createSyncVaultSession()
        const key = await session.unlock(recovery, scope, { signal: life.signal, assertCurrent() {}, async validateReadOnly() {} })
        // Native browser IDB, isolated synthetic database; guards are simulated.
        const name = 'arty-sync-codec-browser-probe'
        const existing = (await indexedDB.databases()).some(db => db.name === name)
        check(existing === (phase === 'reopen'), `unexpected database existence in ${phase}`)
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 1)
          request.onupgradeneeded = () => request.result.createObjectStore('candidates')
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
        })
        const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('transaction aborted')) })
        const write = async rows => { const tx = db.transaction('candidates', 'readwrite'), finished = done(tx); rows.forEach((row, i) => tx.objectStore('candidates').put(row, i)); await finished }
        const read = async () => {
          const tx = db.transaction('candidates'), finished = done(tx), request = tx.objectStore('candidates').getAll()
          const rows = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
          await finished; return rows
        }
        let rows
        try {
          if (phase === 'create') {
            const first = new Blob([new Uint8Array(262157).fill(219)]), second = new Blob(['Synthetic new revision — été 😀'])
            let next = base; rows = []
            for (const [n, blob] of [first, second].entries()) {
              const before = next
              next = stageSyncChange(before, { ...scope, recordId: id(10), kind: 'file', revision: { id: id(20 + n),
                intent: n ? 'edit' : 'create', parents: n ? [id(20)] : [], value: { state: 'live', payloadId: id(100 + n), bytes: blob.size, sha256: await sha(blob) } } })
              const candidate = await E.prepareSyncUpdate(key, before, next, new Map([[id(100 + n), blob]]), { assertCurrent() {}, async validate() {} })
              rows.push({ reference: candidate.reference, ciphertext: candidate.ciphertext })
            }
            await write(rows)
          } else if (phase === 'import') {
            rows = transferred.map(row => ({ reference: row.reference, ciphertext: new Blob([Uint8Array.from(row.ciphertext)]) }))
            await write(rows)
          }
          rows = await read()
          check(rows.length === 2 && rows.every(row => Object.keys(row).sort().join() === 'ciphertext,reference' && row.ciphertext instanceof Blob), 'IDB stored unexpected shape')
          const originalEncrypt = crypto.subtle.encrypt, originalRandom = crypto.getRandomValues
          let encrypts = 0, randoms = 0
          crypto.subtle.encrypt = function (...args) { encrypts++; return originalEncrypt.apply(this, args) }
          crypto.getRandomValues = function (...args) { randoms++; return originalRandom.apply(this, args) }
          try {
            let refused = false
            try { await E.openSyncUpdate(key, rows[1].reference, rows[1].ciphertext, base) } catch (error) { refused = error.message === 'sync_envelope_base' }
            check(refused, 'second delta alone should fail')
            let before = base; const retained = [], hashes = []
            for (const row of rows) {
              const resumed = await E.resumeSyncUpdate(key, row.reference, row.ciphertext, before)
              check(await sha(resumed.ciphertext) === row.reference.sha256, 'retry changed ciphertext')
              const opened = await E.openSyncUpdate(key, row.reference, resumed.ciphertext, before)
              retained.push(opened); before = opened.manifest; hashes.push(row.reference.sha256)
            }
            const firstBytes = new Uint8Array(await retained[0].payload(id(100)).arrayBuffer())
            check(firstBytes.length === 262157 && firstBytes.every(byte => byte === 219), 'lost or changed first payload')
            check(await retained[1].payload(id(101)).text() === 'Synthetic new revision — été 😀', 'changed second payload')
            check(before.records[0].revisions.length === 2, 'lost causal history')
            check(encrypts === 0 && randoms === 0, 'retry resealed data')
            check(localStorage.length === 0 && sessionStorage.length === 0, 'persisted unexpected key state')
            session.lock()
            let locked = false
            try { retained[0].payload(id(100)) } catch (error) { locked = error.message === 'sync_envelope_locked' }
            check(locked, 'unlocked view survived lock')
            return { phase, hashes, encrypts, randoms, existing, secureContext: isSecureContext, synthetic: true,
              transport: phase === 'create' ? await Promise.all(rows.map(async row => ({ reference: row.reference, ciphertext: Array.from(new Uint8Array(await row.ciphertext.arrayBuffer())) }))) : null }
          } finally { crypto.subtle.encrypt = originalEncrypt; crypto.getRandomValues = originalRandom }
        } finally { session.lock(); db.close() }
      }, { phase, transferred })
    } finally { await page.close() } // Destroy the first JS/key realm before reopen.
  }
  const created = await run(contexts[0], 'create')
  const reopened = await run(contexts[0], 'reopen')
  const imported = await run(contexts[1], 'import', created.transport)
  assert.deepEqual(reopened.hashes, created.hashes); assert.deepEqual(imported.hashes, created.hashes)
  assert.deepEqual(unexpectedNetwork, []); assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), nativeWebCryptoAndIDB: true,
    pageRealmDestroyedAndReopened: true, independentBrowserContexts: 2, ciphertexts: created.hashes,
    retryEncrypts: reopened.encrypts + imported.encrypts, unexpectedNetwork: 0, pageErrors: 0,
    caveat: 'Synthetic codec and storage probe; no application capture, real outbox, account guard, server ACK, phone or cloud activation.' }, null, 2))
} finally { await browser?.close(); await server.close() }
