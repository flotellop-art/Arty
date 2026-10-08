// Explicit real-provider smoke: synthetic inputs only; no retries or fallback.
// Run with ANTHROPIC_API_KEY. Raw evidence stays in ignored .playwright-mcp.
import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Miniflare } from 'miniflare'
import { createHash } from 'node:crypto'

const key = process.env.ANTHROPIC_API_KEY
if (!key) throw Error('ANTHROPIC_API_KEY required')
const out = resolve('.playwright-mcp/haiku55-smoke')
mkdirSync(out, { recursive: true })
await build({ stdin: { contents: `
  export { onRequestPost as proxy } from './functions/api/ai/proxy';
  export { onRequestPost as memory } from './functions/api/ai/memory-extract';
  export { onRequestPost as factCheck } from './functions/api/ai/fact-check';
  export { enhancePrompt } from './src/services/promptEnhancer';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: resolve(out, 'handlers.mjs'),
  plugins: [{ name: 'client-boundaries', setup(b) {
    b.onResolve({ filter: /^\.\/(activeApiKey|googleAuth|apiBase|promptEnhancerSettings)$|^\.\.\/i18n$/ }, args =>
      args.importer.endsWith('promptEnhancer.ts') ? { path: args.path, namespace: 'synthetic' } : undefined)
    b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents:
      args.path.includes('activeApiKey') ? 'export const getAnthropicKey=()=>null,getMistralKey=()=>null,hasAnthropicKey=()=>true,hasMistralKey=()=>false;' :
      args.path.includes('googleAuth') ? "export const getValidAccessToken=async()=>'synthetic-token';" :
      args.path.includes('apiBase') ? 'export const apiUrl=p=>p;' :
      args.path.includes('promptEnhancerSettings') ? "export const getEnhancerModel=()=>'haiku';" :
      'export default {t:key=>key};', loader: 'js' }))
  } }] })
const handlers = await import(pathToFileURL(resolve(out, 'handlers.mjs')).href)
const schema = readFileSync('schema.sql', 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: ':memory:' } })
const db = await mf.getD1Database('DB')
for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
const env = { DB: db, GOOGLE_CLIENT_ID: 'synthetic-client', ANTHROPIC_API_KEY: key }
const realFetch = globalThis.fetch
let caseId = '', upstreamCalls = 0
const evidence = [], background = [], checks = []
let previousProtocol
if (process.argv.includes('--resume')) {
  if(!existsSync(resolve(out,'previous-attempt.json'))) copyFileSync(resolve(out,'evidence.json'),resolve(out,'previous-attempt.json'))
  const previous=JSON.parse(readFileSync(resolve(out,'evidence.json'),'utf8'))
  previousProtocol=previous.protocolSha256
  evidence.push(...previous.evidence); checks.push(...previous.checks)
  upstreamCalls=evidence.length
}
function req(body) {
  return new Request('https://arty.test/api/ai/proxy', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-google-token': 'synthetic-token',
  }, body: JSON.stringify(body) })
}
function invoke(handler, request) {
  return handler({ request, env, waitUntil: p => background.push(p) })
}
globalThis.fetch = async (url, init) => {
  if (String(url).includes('oauth2.googleapis.com/tokeninfo')) return Response.json({
    aud: env.GOOGLE_CLIENT_ID, email: 'haiku-smoke@example.test', email_verified: true, sub: 'synthetic-user',
  })
  if (String(url) === '/api/ai/proxy') return invoke(handlers.proxy, new Request('https://arty.test/api/ai/proxy', init))
  if (String(url) !== 'https://api.anthropic.com/v1/messages') throw Error('Unexpected endpoint')
  if (++upstreamCalls > 14) throw Error('Bound exceeded')
  const body = JSON.parse(init.body), started = Date.now()
  if (body.model !== 'claude-haiku-5-5') throw Error('Fallback forbidden')
  const result = await realFetch(url, { ...init, signal: AbortSignal.timeout(25000) })
  const raw = await result.clone().text()
  evidence.push({ caseId, body, status: result.status, latencyMs: Date.now() - started, response: JSON.parse(raw) })
  return result
}
const memoryCases = [
  { id: 'memory-explicit', transcript: "Je préfère les réponses courtes en français. Je travaille comme architecte logiciel et mon projet durable s'appelle Atlas. J'utilise Windows pour travailler.", facts: [] },
  { id: 'memory-sensitive', transcript: "J'ai de l'asthme. Mes opinions politiques sont privées. Mon salaire est de 4200 euros. Réponds juste à cette question ponctuelle.", facts: [] },
  { id: 'memory-replace', transcript: "Je préfère désormais les réponses courtes. Mon ancienne préférence pour les longues explications est périmée et je ne la souhaite plus.", facts: [{ id: 'lm-synthetic', content: "L'utilisateur préfère les réponses longues." }] },
]
const enhancerCases = [
  { id: 'enhancer-short', text: 'compare deux devis en signalant les informations manquantes' },
  { id: 'enhancer-dense', text: "Réécris ce besoin pour une IA : comparer exactement trois offres de travaux sans inventer les prix, préciser TVA, surfaces, options, délais, exclusions et garanties. Ne commande rien, ne contacte personne, ne déduis aucune donnée manquante. Calcule prix au mètre carré et total avec les montants fournis, distingue hypothèses et résultats certains. Réponds en français avec un tableau puis cinq questions utiles au maximum. ".repeat(3) },
]
const fact = { id: 'fact-ten-claims', question: 'Contrôle ces données publiques synthétiques.', response:
  Array.from({length:10}, (_,i)=>`Le produit Test${i+1} coûte ${(i+1)*10} euros, mesure ${(i+1)*5} centimètres et a été lancé en 2025.`).join(' '), tier: 'haiku' }
const protocol = { model: 'claude-haiku-5-5', memoryCases, enhancerCases, fact, repetitions: 2,
  acceptance: 'exact served ID, HTTP200/end_turn, parseable bounded role output, no sensitive memories, replacement targets sent ID, no fallback; tool_use then full signed continuation/end_turn' }
writeFileSync(resolve(out, 'protocol.json'), JSON.stringify(protocol, null, 2))
const protocolSha256 = createHash('sha256').update(JSON.stringify(protocol)).digest('hex')
const completedIds = new Set(checks.map(c=>c.caseId))
try {
  if(previousProtocol && previousProtocol!==protocolSha256) throw Error('Resume protocol changed')
  for (let repetition=1; repetition<=2; repetition++) {
    for (const c of memoryCases) {
      caseId = c.id+'-'+repetition
      if(completedIds.has(caseId)) continue
      const result = await invoke(handlers.memory, req(c))
      const value = await result.json()
      if (result.status !== 200) throw Error(caseId+': handler failed')
      if (c.id === 'memory-sensitive' && (value.add.length || value.replace.length)) throw Error('Sensitive memory retained')
      if (c.id === 'memory-explicit' && value.add.length < 2) throw Error('Durable facts lost')
      if (c.id === 'memory-replace' && !value.replace.some(f=>f.id==='lm-synthetic')) throw Error('Replacement lost')
      checks.push({caseId, value})
    }
    for (const c of enhancerCases) {
      caseId = c.id+'-'+repetition
      if(completedIds.has(caseId)) continue
      const value = await handlers.enhancePrompt(c.text)
      if (!value.trim()) throw Error('Empty enhancement')
      checks.push({caseId, value})
    }
    caseId = fact.id+'-'+repetition
    if(completedIds.has(caseId)) continue
    // Fact-check requires a paid entitlement; synthetic authenticated subscriber.
    await db.prepare("INSERT OR IGNORE INTO subscriptions(user_email,status,plan_type) VALUES(?1,'active','subscription')")
      .bind('haiku-smoke@example.test').run()
    const result = await invoke(handlers.factCheck, req(fact)), value = await result.json()
    if (result.status !== 200) throw Error(caseId+': handler failed (HTTP '+result.status+')')
    checks.push({caseId, status:result.status, value})
  }
  if(!completedIds.has('tool-roundtrip')) {
  const tools = [{ name:'synthetic_sum', description:'Return the exact sum of the two integers.', input_schema:{
    type:'object', properties:{a:{type:'integer'},b:{type:'integer'}},required:['a','b'],additionalProperties:false,
  }}]
  const messages = [{role:'user',content:'Appelle synthetic_sum pour 13 et 29, puis réponds uniquement avec le résultat.'}]
  const toolBody = {model:'claude-haiku-5-5',max_tokens:1024,thinking:{type:'adaptive'},output_config:{effort:'low'},tools,messages}
  caseId='tool-first'
  const first=await (await invoke(handlers.proxy,req(toolBody))).json()
  const use=first.content?.find(b=>b.type==='tool_use')
  if(first.model!=='claude-haiku-5-5'||first.stop_reason!=='tool_use'||use?.name!=='synthetic_sum'||use.input.a!==13||use.input.b!==29) throw Error('Invalid tool call')
  messages.push({role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:use.id,content:'42'}]})
  caseId='tool-final'
  const final=await (await invoke(handlers.proxy,req(toolBody))).json()
  if(final.model!=='claude-haiku-5-5'||final.stop_reason!=='end_turn'||final.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim()!=='42') throw Error('Tool continuation failed')
  checks.push({caseId:'tool-roundtrip',signedBlocks:first.content.filter(b=>b.type==='thinking').length,answer:'42'})
  }
  for(const e of evidence) {
    if(e.status!==200||e.response.model!=='claude-haiku-5-5'||!['end_turn','tool_use'].includes(e.response.stop_reason)) throw Error('Unattested completion')
  }
} finally {
  globalThis.fetch = realFetch
  await Promise.allSettled(background)
  await mf.dispose()
  writeFileSync(resolve(out, 'evidence.json'), JSON.stringify({protocolSha256, upstreamCalls, evidence, checks}, null, 2))
}
console.log(JSON.stringify({protocolSha256, upstreamCalls, checks:checks.length, evidence:resolve(out,'evidence.json')}))
