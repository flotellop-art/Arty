// Native Chrome IDB/Web Locks/WebCrypto in disposable synthetic profiles.
// Internal historical snapshot service only, NOT app capture/ACK/mobile proof.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)(process.env.ARTY_PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ configFile: false, logLevel: 'error', appType: 'custom',
  optimizeDeps: { entries: [], include: ['idb', '@capacitor/core'] }, server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } })
server.middlewares.use((req, res, next) => {
  if (req.url !== '/__sync-outbox-probe.html') return next()
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic local outbox probe</title>')
})
let browser
try {
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ channel: process.env.ARTY_BROWSER_CHANNEL || 'chrome', headless: true })
  const errors = [], unexpectedNetwork = [], receipts = []
  for (const scenario of ['reopen', 'quota', 'commit-cut']) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(route.request().method())) {
        unexpectedNetwork.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort()
      }
      return route.continue()
    })
    const run = async phase => {
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      try {
        await page.goto(`${origin}/__sync-outbox-probe.html`)
        return await page.evaluate(async ({ phase, scenario }) => {
          const check = (v, message) => { if (!v) throw new Error(message) }
          const { openDB } = await import('/node_modules/idb/build/index.js')
          const R = await import('/src/services/workspaceWriter/runtime.ts')
          const { createDatabaseShape, CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } = await import('/src/services/workspaceWriter/schema.ts')
          const { isolatedWorkspaceLayout, workspaceDataKey } = await import('/src/services/workspaceWriter/layout.ts')
          const generation = '76ba201a-547f-44a1-9000-111111111111', layout = isolatedWorkspaceLayout(generation, [], 2)
          const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
          const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, bound = { vaultId: id(1), epoch: id(2) }
          check(await R.documentWorkspace.acquire() === 'held', 'native lock not held')
          if (phase === 'adopt') {
            for (const [name, version, shape] of [['arty-files', 2, FILE_SHAPE], ['arty-projects', 2, PROJECT_SHAPE],
              [layout.files.name, 1, FILE_SHAPE], [layout.projects.name, 2, PROJECT_SHAPE], ['arty-workspace-control', 1, CONTROL_SHAPE]]) {
              const db = await openDB(name, version, { upgrade(db) { createDatabaseShape(db, shape) } }); db.close()
            }
            const control = await openDB('arty-workspace-control', 1)
            await control.put('meta', { format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', state: 'ready', revision: 1,
              generation, requiredOwners: [], projectsVersion: 2 }, 'workspace'); control.close()
          }
          check(await R.workspaceAdmission.admit() === 'ready', 'real admission refused')
          const U = await import('/src/services/userSession.ts'), C = await import('/src/services/crypto.ts')
          U.setActiveSession({ userId: 'synthetic-a', authMethod: 'apikey', displayName: 'Synthetic', createdAt: 1 }); await C.initCrypto('synthetic-local-key')
          const { createLocalSyncOutbox } = await import('/src/services/workspaceSync/localOutbox.ts')
          const readRows = async () => { const db = await openDB(layout.projects.name, 2); try { return JSON.stringify([await db.getAllKeys('meta'), await db.getAll('meta')]) } finally { db.close() } }
          const box = createLocalSyncOutbox()
          if (phase === 'adopt') {
            await box.unlock(code, bound)
            const payload = new Blob(['Historical snapshot A']), sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await payload.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
            const { stageSyncChange } = await import('/src/services/workspaceSync/causal.ts')
            const next = stageSyncChange(box.snapshot.base, { ...bound, recordId: id(3), kind: 'conversation',
              revision: { id: id(4), intent: 'create', parents: [], value: { state: 'live', payloadId: id(5), bytes: payload.size, sha256 } } })
            const candidate = await box.prepareSnapshot(next, new Map([[id(5), payload]]), [{ kind: 'conversation', localId: 'chat', parentLocalId: null, logicalId: id(3), presence: 'record' }])
            const before = await readRows(), put = IDBObjectStore.prototype.put, transaction = IDBDatabase.prototype.transaction
            let refused = false, failure = ''
            IDBObjectStore.prototype.put = function(value, key) {
              if (this.transaction.db.name === layout.projects.name && value?.format === 'arty-sync-local-state') {
                if (scenario === 'quota') throw new DOMException('synthetic quota', 'QuotaExceededError')
              }
              return put.call(this, value, key)
            }
            // Register before idb's completion Promise: native Chrome runs a
            // microtask checkpoint between event listeners, unlike fake IDB.
            IDBDatabase.prototype.transaction = function(...args) {
              const tx = transaction.apply(this, args)
              if (scenario === 'commit-cut' && this.name === layout.projects.name && args[1] === 'readwrite') tx.addEventListener('complete', () => R.documentWorkspace.retire(), { once: true })
              return tx
            }
            try { await candidate.adopt() } catch (error) { refused = true; failure = error.message }
            finally { IDBObjectStore.prototype.put = put; IDBDatabase.prototype.transaction = transaction }
            check(refused === (scenario !== 'reopen'), `unexpected commit outcome ${scenario}: ${failure}`)
            if (scenario === 'quota') {
              check(await readRows() === before, 'partial pair after quota')
              const encrypt = crypto.subtle.encrypt; crypto.subtle.encrypt = () => { throw new Error('reseal on quota retry') }
              try { await candidate.adopt() } finally { crypto.subtle.encrypt = encrypt }
            }
            const adopted = await readRows()
            if (scenario !== 'commit-cut') {
              box.lock()
              const H = await import('/src/services/storage.ts'); await H.bootstrapConversationStorage()
              H.saveConversation({ id: 'chat', title: 'B', createdAt: 1, updatedAt: 2, messages: [{ id: 'message-b', role: 'user', content: 'Local B', timestamp: 2 }] })
              const until = performance.now() + 10_000
              while (!localStorage.getItem(workspaceDataKey(layout, 'synthetic-a', 'conversations-enc'))) {
                check(performance.now() < until, 'chat B not durably encrypted'); await new Promise(r => setTimeout(r, 10))
              }
              check(await readRows() === adopted, 'chat B overwrote A')
            }
            return { rows: adopted, operationId: candidate.reference.operationId }
          }
          const before = await readRows(), encrypt = crypto.subtle.encrypt, random = crypto.getRandomValues, uuid = crypto.randomUUID
          crypto.subtle.encrypt = crypto.getRandomValues = crypto.randomUUID = () => { throw new Error('re-encryption/random forbidden on resume') }
          try {
            await box.unlock(code); const resumed = await box.resume()
            check(resumed !== null, 'pending operation lost'); check(await readRows() === before, 'resume wrote storage')
            check(box.snapshot.base.records.length === 0, 'local adoption was falsely acknowledged')
            return { rows: before, operationId: resumed.reference.operationId }
          } finally { crypto.subtle.encrypt = encrypt; crypto.getRandomValues = random; crypto.randomUUID = uuid }
        }, { phase, scenario })
      } finally { await page.close() }
    }
    const adopted = await run('adopt'), resumed = await run('resume')
    assert.deepEqual(resumed, adopted); receipts.push({ scenario, exactRowsAndReference: true, nativeIDB: true, reencryptOnResume: false })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, [])
  console.log(JSON.stringify({ status: 'PASS', utc: new Date().toISOString(), browser: browser.version(), receipts, errors, unexpectedNetwork }, null, 2))
} finally { await browser?.close(); await server.close() }
