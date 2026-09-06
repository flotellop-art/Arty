// Actual cold actor + native Chrome IndexedDB/Web Locks. Synthetic isolated
// data in a disposable profile, NOT a production account or mobile proof.
// The test build alone enables START; the repository's release flag stays OFF.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.ARTY_PLAYWRIGHT_MODULE || 'playwright')
let gateTransformed = false
const server = await createServer({ configFile: false, logLevel: 'error', appType: 'custom',
  optimizeDeps: { entries: [], include: ['idb', '@capacitor/core'] },
  plugins: [{ name: 'synthetic-upgrade-start', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/services/workspaceWriter/activation.ts')) return
    const flag = 'export const WORKSPACE_UPGRADE_START_ENABLED = false'
    assert(code.includes(flag), 'release START policy unexpectedly changed')
    gateTransformed = true; return code.replace(flag, 'export const WORKSPACE_UPGRADE_START_ENABLED = true')
  } }], server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } })
server.middlewares.use((req, res, next) => {
  if (req.url !== '/__upgrade-probe.html') return next()
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic local upgrade probe</title>')
})
let browser
try {
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ channel: process.env.ARTY_BROWSER_CHANNEL || 'chrome', headless: true })
  const errors = [], unexpectedNetwork = [], receipts = []
  for (const scenario of ['complete', 'ticket-cut', 'physical-cut', 'blocked', 'deleted']) {
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
        await page.goto(`${origin}/__upgrade-probe.html`)
        return await page.evaluate(async ({ phase, scenario }) => {
          const check = (condition, message) => { if (!condition) throw new Error(message) }
          const { openDB } = await import('/node_modules/idb/build/index.js')
          const R = await import('/src/services/workspaceWriter/runtime.ts')
          const { createColdWorkspaceUpgrade } = await import('/src/services/workspaceWriter/upgrade.ts')
          const { createDatabaseShape, CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } = await import('/src/services/workspaceWriter/schema.ts')
          const { isolatedWorkspaceLayout } = await import('/src/services/workspaceWriter/layout.ts')
          const { rawEncoding } = await import('/src/services/workspaceWriter/migrationInventory.ts')
          const generation = '76ba201a-547f-44a1-9000-111111111111', owners = ['a', 'a-b', 'a:b']
          const layout = isolatedWorkspaceLayout(generation, owners), fence = 'synthetic-fence'
          check(await R.documentWorkspace.acquire() === 'held', 'native Web Lock was not granted')
          const readRoot = async () => { const db = await openDB('arty-workspace-control', 1); try { return await db.get('meta', 'workspace') } finally { db.close() } }
          const snapshot = async () => {
            const rows = []
            for (const { name } of await indexedDB.databases()) {
              if (name === 'arty-workspace-control') continue
              const db = await openDB(name)
              try { for (const store of db.objectStoreNames) rows.push([name, store, await db.getAllKeys(store), await db.getAll(store)]) } finally { db.close() }
            }
            rows.sort((a, b) => `${a[0]}/${a[1]}`.localeCompare(`${b[0]}/${b[1]}`))
            return rawEncoding([rows, Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])])
          }
          if (phase === 'seed') {
            for (const [name, version, shape] of [['arty-files', 2, FILE_SHAPE], ['arty-projects', 2, PROJECT_SHAPE],
              [layout.files.name, 1, FILE_SHAPE], [layout.projects.name, 1, PROJECT_SHAPE], ['arty-workspace-control', 1, CONTROL_SHAPE]]) {
              const db = await openDB(name, version, { upgrade(db) { createDatabaseShape(db, shape) } }); db.close()
            }
            const c = await openDB('arty-workspace-control', 1)
            await c.put('meta', { format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', state: 'ready', revision: 1, generation, requiredOwners: owners }, 'workspace'); c.close()
            const p = await openDB(layout.projects.name, 1)
            await p.put('meta', fence, 'erasure-fence')
            for (const owner of owners) await p.put('projects', { key: [owner, 'p'], owner, id: 'p', cipher: 'synthetic\ud800', extra: undefined, negativeZero: -0 })
            p.close(); localStorage.setItem('arty-project-erasure-fence', fence); localStorage.setItem('synthetic-history', 'untouched\ud800')
          }
          const before = await snapshot()
          if (phase === 'admit') {
            check(await R.workspaceAdmission.admit() === 'ready', 'new document not ready')
            check(R.getDocumentStorageLayout().projects.version === 2, 'wrong physical layout')
            return { phase, root: await readRoot(), before, secure: isSecureContext }
          }
          const originalPut = IDBObjectStore.prototype.put, originalOpen = indexedDB.open.bind(indexedDB)
          let held, failed = false
          if (phase === 'seed' && ['ticket-cut', 'physical-cut'].includes(scenario)) IDBObjectStore.prototype.put = function(value, key) {
            if (this.transaction.db.name === 'arty-workspace-control') {
              if (scenario === 'ticket-cut' && value.version === 9) this.transaction.addEventListener('complete', () => R.documentWorkspace.retire(), { once: true })
              if (scenario === 'physical-cut' && value.projectsVersion === 2) throw new Error('synthetic cut')
            }
            return originalPut.call(this, value, key)
          }
          if (phase === 'seed' && scenario === 'blocked') held = await openDB(layout.projects.name, 1)
          if (phase === 'seed' && scenario === 'deleted') indexedDB.open = (name, version) => {
            if (name === layout.projects.name && version === 2) indexedDB.deleteDatabase(name)
            return originalOpen(name, version)
          }
          try { await createColdWorkspaceUpgrade(phase === 'seed' ? 'start' : 'resume').run() } catch { failed = true }
          finally { IDBObjectStore.prototype.put = originalPut; indexedDB.open = originalOpen; held?.close() }
          const root = await readRoot()
          check(failed === (phase === 'seed' && scenario !== 'complete'), `unexpected outcome ${scenario}/${phase}`)
          let physical
          if (scenario === 'deleted') check(!(await indexedDB.databases()).some(db => db.name === layout.projects.name), 'deleted database was recreated')
          else { const db = await openDB(layout.projects.name); physical = db.version; db.close() }
          check(root.version === (failed ? 9 : 2), 'wrong durable root')
          check(scenario === 'deleted' || physical === (phase === 'seed' && ['ticket-cut', 'blocked'].includes(scenario) ? 1 : 2), 'late or missing physical transition')
          if (!failed) check(R.workspaceAdmission.getSnapshot() === 'maintenance', 'warm private admission granted')
          check(scenario === 'deleted' || before === await snapshot(), 'user data changed')
          return { phase, root, before, physical, failed, secure: isSecureContext }
        }, { phase, scenario })
      } finally { await page.close() } // Native destruction releases the real Web Lock.
    }
    const first = await run('seed')
    if (scenario !== 'deleted') {
      if (scenario !== 'complete') { const resumed = await run('resume'); assert.equal(resumed.before, first.before); assert.equal(resumed.root.revision, 3) }
      const admitted = await run('admit'); assert.equal(admitted.before, first.before); assert.equal(admitted.root.revision, 3)
    }
    receipts.push({ scenario, initialPhysical: first.physical ?? 'absent', interrupted: first.failed, secureContext: first.secure })
    await context.close()
  }
  assert(gateTransformed); assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, [])
  console.log(JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), nativeIndexedDBAndWebLocks: true,
    syntheticStartBuildOnly: true, releaseStartEnabled: false, scenarios: receipts, unexpectedNetwork, pageErrors: errors }, null, 2))
} finally { await browser?.close(); await server.close() }
