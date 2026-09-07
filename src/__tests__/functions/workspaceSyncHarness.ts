import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, Response as LocalResponse, type MiniflareOptions } from 'miniflare'

export async function makeWorkspaceSyncHarness(start = 'true', bucket = true) {
  const root = resolve('.').replaceAll('\\', '/')
  const bundle = await build({ stdin: { contents: `
    import { onRequest as middleware } from '${root}/functions/api/_middleware.ts';
    import { onRequest as sync } from '${root}/functions/api/workspace-sync/v1.ts';
    import { onRequestPost as erase, onRequestGet as receipt } from '${root}/functions/api/account/erasure-v1.ts';
    import { onRequestPost as cleanup } from '${root}/functions/api/account/erasure-cleanup-v1.ts';
    import { onRequestPost as legacy } from '${root}/functions/api/account/delete.ts';
    export default { async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      const handler = path === '/api/workspace-sync/v1' ? sync
        : path === '/api/account/erasure-v1' ? request.method === 'POST' ? erase : receipt
        : path === '/api/account/erasure-cleanup-v1' ? cleanup
        : path === '/api/account/delete' ? legacy : null;
      if (!handler) return new Response(null, {status: 404});
      return middleware({ request, env, next: () => handler({request,env,waitUntil:ctx.waitUntil.bind(ctx)}) });
    } }`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' })
  const authCalls: string[] = []
  const options: MiniflareOptions = { host: '127.0.0.1', port: 0, modules: true, script: bundle.outputFiles[0]!.text,
    // Match the Pages production setting re-read before B3 release. Do not
    // silently test newer runtime semantics than the deployed account uses.
    compatibilityDate: '2026-04-10', d1Databases: { DB: 'sync-synthetic' }, r2Buckets: bucket ? { WORKSPACE_SYNC_BUCKET: 'sync-synthetic' } : {},
    bindings: { GOOGLE_CLIENT_ID: 'synthetic-arty-client', WORKSPACE_SYNC_START_ENABLED: start },
    outboundService(request) {
      const url = new URL(request.url)
      if (url.origin !== 'https://oauth2.googleapis.com' || url.pathname !== '/tokeninfo') throw new Error('Unexpected outbound request')
      const token = url.searchParams.get('access_token'); authCalls.push(token ?? '')
      if (!['a', 'b', 'same-email-other-sub', 'missing-sub', 'bad-sub', 'wrong-audience'].includes(token ?? '')) return LocalResponse.json({}, { status: 401 })
      return LocalResponse.json({ email: token === 'b' ? 'b@example.test' : 'a@example.test', email_verified: true,
        aud: token === 'wrong-audience' ? 'foreign-client' : 'synthetic-arty-client',
        ...(token === 'missing-sub' ? {} : { sub: token === 'bad-sub' ? { invalid: true } : token === 'b' ? '222222' : token === 'same-email-other-sub' ? '333333' : '111111' }) })
    },
  }
  const mf = new Miniflare(options)
  let db = await mf.getD1Database('DB')
  const statements = (path: string) => readFileSync(path, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
  for (const sql of [...statements('schema.sql'), ...statements('migrations/0009_workspace_sync.sql')]) await db.prepare(sql).run()
  let requests = 0
  const request = (action: string, data?: object, token = 'a', extra: Record<string, string> = {}) => mf.dispatchFetch(
    `https://tryarty.com/api/workspace-sync/v1?action=${action}`, { method: 'POST', headers: {
      Origin: 'https://tryarty.com', 'Content-Type': 'application/json', 'x-google-token': token,
      'cf-connecting-ip': `192.0.2.${++requests % 200 + 1}`, ...extra }, body: JSON.stringify(data) })
  return { mf, get db() { return db }, authCalls, request,
    configure: async (enabled: string, withBucket = true) => {
      await mf.setOptions({ ...options,
        bindings: { GOOGLE_CLIENT_ID: 'synthetic-arty-client', WORKSPACE_SYNC_START_ENABLED: enabled },
        r2Buckets: withBucket ? { WORKSPACE_SYNC_BUCKET: 'sync-synthetic' } : {} })
      db = await mf.getD1Database('DB')
    },
    dispose: () => mf.dispose() }
}
