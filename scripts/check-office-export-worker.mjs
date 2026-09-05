// Smoke the actual Vite browser worker bundle in a no-network VM. This is NOT
// a browser/CSP/device test. Input must be the synthetic fixture from the test.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// Hard process deadline also covers a CPU loop after an await (a same-thread
// Promise.race alone cannot interrupt that). No shell or network in this check.
if (process.argv[2] !== '--child') {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', ...process.argv.slice(2)], {
    encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024, windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) console.error(`Worker smoke failed or exceeded 45 seconds: ${result.error.message}`)
  process.exit(result.error ? 1 : result.status ?? 1)
}
const folder = process.argv[3] ? resolve(process.argv[3]) : null
const name = readdirSync('dist/assets').find(n => /^officeExport\.worker-.*\.js$/.test(n))
if (!name) throw new Error('Build the app first')
const source = readFileSync(join('dist/assets', name), 'utf8')
const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Blob,
  crypto: globalThis.crypto, atob, btoa, URL, queueMicrotask,
  importScripts() { throw new Error('External scripts are forbidden in this test') } })
let reply
context.self = context
context.postMessage = value => { reply = value }
try { vm.runInContext(source, context, { timeout: 2000 }) }
catch (error) { throw new Error(`Worker startup failed: ${error.message}`) }
async function request(body) {
  reply = null
  await context.onmessage({ data: body })
  if (!reply || reply.error) throw new Error(reply?.error ?? 'No reply')
  return reply
}
const snapshot = folder ? JSON.parse(readFileSync(join(folder, 'input.json'), 'utf8')) : { title: 'Smoke test Arty', messages: [1, 2].map(i => ({
  id: `m${i}`, role: 'assistant', model: '', sources: [], attachments: 0, interrupted: false,
  content: `# Éditable &eacute;\n\n| Valeur |\n| --- |\n| 0012 |\n| =1+1 |`,
})) }
const parsed = await request({ id: 'fixture-parse', kind: 'parse', snapshot })
if (parsed.document.messages.length !== 2) throw new Error('Wrong preview')
for (const format of ['docx', 'xlsx']) {
  const packed = await request({ id: format, kind: 'pack', choices: { format, tableIds: ['table-1', 'table-2'] } })
  if (!packed.buffer || packed.buffer.byteLength < 100) throw new Error(`Empty ${format}`)
  if (folder) writeFileSync(join(folder, `arty-editable.${format}`), new Uint8Array(packed.buffer))
}
console.log(`PASS actual ${name} in isolated VM, no process/require/fetch; synthetic exports regenerated. Not a visual or native test.`)
