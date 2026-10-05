// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
let mf: Miniflare
beforeAll(async () => {
  const source = fileURLToPath(new URL('../../../services/url-reader/src/admission.ts', import.meta.url))
  const result = await build({ stdin: { contents: `export { ReaderAdmission } from ${JSON.stringify(source)}; export default {fetch(){return new Response('ok')}}`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'neutral' })
  mf = new Miniflare({ modules: true, script: result.outputFiles[0].text,
    durableObjects: { ADMISSION: { className: 'ReaderAdmission', useSQLite: true } } })
})
afterAll(async () => { await mf?.dispose() })
async function instance(name: string) {
  const namespace = await mf.getDurableObjectNamespace('ADMISSION')
  const stub = namespace.get(namespace.idFromName(name))
  return async (body: unknown) => {
    const r = await stub.fetch('https://admission.internal/', { method: 'POST', body: JSON.stringify(body) })
    return { status: r.status, data: await r.json() as { allowed?: boolean; lease?: string } }
  }
}
describe('reader admission with real workerd SQLite', () => {
  it('serializes concurrent admissions, retains uncertain slots, releases only explicit leases', async () => {
    const call = await instance('concurrency')
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call({ subject: i.toString(16).padStart(64, '0') })))
    const admitted = results.filter(r => r.data.allowed)
    expect(admitted).toHaveLength(2)
    expect(results.filter(r => r.status === 429)).toHaveLength(10)
    expect((await call({ subject: 'f'.repeat(64) })).status).toBe(429)
    await call({ release: admitted[0].data.lease })
    expect((await call({ subject: 'f'.repeat(64) })).data.allowed).toBe(true)
  })
  it('enforces20 attempts per identity and100 globally, including failed reads', async () => {
    const call = await instance('daily')
    for (let user = 0; user < 5; user++) {
      const subject = user.toString(16).padStart(64, '0')
      for (let n = 0; n < 20; n++) {
        const r = await call({ subject }); expect(r.data.allowed).toBe(true)
        await call({ release: r.data.lease }) // no attempt refund on release
      }
      expect((await call({ subject })).status).toBe(429)
    }
    expect((await call({ subject: 'f'.repeat(64) })).status).toBe(429)
  })
})
