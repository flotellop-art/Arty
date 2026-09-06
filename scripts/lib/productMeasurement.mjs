// Operator-only. No network, user-level rows or client-controlled labels.
import { validateWindow } from './walletMeasurement.mjs'
export const SCHEMA = 'arty-product-measurement-client-reply-v1'
export const OUTCOMES = ['saved', 'empty', 'error', 'stopped', 'not_saved', 'not_started']
const fail = () => { throw new Error('Rapport indisponible : agrégat absent ou incohérent.') }
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length || keys.some(key => {
      const d = Object.getOwnPropertyDescriptor(value, key)
      return !d?.enumerable || !('value' in d)
    })) fail()
}

export function measurementSQL(from, to) {
  validateWindow(from, to)
  return `SELECT '${SCHEMA}' AS schema, '${from}' AS period_from, '${to}' AS period_to,
    datetime('now') AS snapshot_utc,
    json_group_array(json_object('day', day, ${OUTCOMES.map(key => `'${key}', ${key}`).join(', ')}, 'total', total)) AS days_json
  FROM (SELECT day, ${OUTCOMES.join(', ')}, total FROM product_measurement_client_reply_v1
    WHERE day >= '${from}' AND day < '${to}' ORDER BY day LIMIT 32);`
}

export function validateAggregate(value) {
  exact(value, ['schema', 'period_from', 'period_to', 'snapshot_utc', 'days_json'])
  if (value.schema !== SCHEMA) fail()
  const window = validateWindow(value.period_from, value.period_to)
  if (typeof value.snapshot_utc !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.snapshot_utc)) fail()
  const stamp = new Date(value.snapshot_utc.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(+stamp) || stamp.toISOString().slice(0, 19).replace('T', ' ') !== value.snapshot_utc) fail()
  if (typeof value.days_json !== 'string' || Buffer.byteLength(value.days_json) > 16_384) fail()
  let days
  try { days = JSON.parse(value.days_json) } catch { fail() }
  if (!Array.isArray(days) || days.length > window.days) fail()
  let previous = ''
  for (const day of days) {
    exact(day, ['day', ...OUTCOMES, 'total'])
    if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day) ||
      day.day <= previous || day.day < window.from || day.day >= window.to || day.day > value.snapshot_utc.slice(0, 10)) fail()
    const parsed = new Date(day.day + 'T00:00:00Z')
    if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day.day) fail()
    for (const key of [...OUTCOMES, 'total']) if (!Number.isSafeInteger(day[key]) || day[key] < 0 || day[key] > 10_000) fail()
    if (!day.total || OUTCOMES.reduce((sum, key) => sum + day[key], 0) !== day.total) fail()
    previous = day.day
  }
  // Detached allowlist snapshot, never return caller-owned objects.
  return { schema: SCHEMA, period_from: window.from, period_to: window.to,
    snapshot_utc: value.snapshot_utc, days_json: JSON.stringify(days.map(day => Object.fromEntries(['day', ...OUTCOMES, 'total'].map(key => [key, day[key]])))) }
}

export function parseAggregate(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65_536) fail()
  let value
  try { value = JSON.parse(text) } catch { fail() }
  if (Array.isArray(value)) {
    if (value.length !== 1 || value[0]?.success !== true || !Array.isArray(value[0].results) || value[0].results.length !== 1) fail()
    value = value[0].results[0]
  }
  return validateAggregate(value)
}

const copy = {
  fr: { title: 'Déclarations facultatives reçues — Réponse client Web',
    limits: 'Échantillon volontaire de comptes Google avec jeton déjà prêt. Aucun contenu ni identifiant conservé dans ces compteurs. Ni utilisateurs uniques, ni taux global de réussite, ni activation, D7/D30 ou conversion. Enregistré signifie copie locale synchrone, pas qualité ni chiffrement terminé. Réseau, consentement, fermeture et plafond biaisent les résultats. Une date absente ne prouve pas une absence d’usage. Un import ne prouve pas sa provenance D1.',
    empty: 'Aucune déclaration reçue dans la fenêtre ; usage réel inconnu.',
    labels: ['Jour UTC', 'Enregistrée', 'Vide', 'Erreur', 'Arrêtée', 'Non enregistrée', 'Non démarrée', 'Déclarations reçues'],
    period: 'Début inclus / fin exclue UTC', snapshot: 'Snapshot déclaré UTC', cap: 'Jours au plafond de 10 000' },
  en: { title: 'Optional declarations received — Web Client reply',
    limits: 'Self-selected Google accounts with an already-ready token. No content or identifier retained in these counters. Not unique users, global success rate, activation, D7/D30 or conversion. Saved means synchronous local copy, not quality or completed encryption. Network, consent, closure and cap bias the results. An absent date does not prove no use. An import does not prove D1 provenance.',
    empty: 'No declaration received in this window; actual use is unknown.',
    labels: ['UTC day', 'Saved', 'Empty', 'Error', 'Stopped', 'Not saved', 'Not started', 'Declarations received'],
    period: 'Start inclusive / end exclusive UTC', snapshot: 'Declared UTC snapshot', cap: 'Days at the 10,000 cap' },
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const csv = row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')
export function renderMeasurement(input, format, locale = 'fr') {
  if (!['html', 'csv', 'json'].includes(format) || !Object.hasOwn(copy, locale)) fail()
  const row = validateAggregate(input), c = copy[locale], days = JSON.parse(row.days_json)
  const totals = Object.fromEntries([...OUTCOMES, 'total'].map(key => [key, days.reduce((sum, day) => sum + day[key], 0)]))
  const capDays = days.filter(day => day.total === 10_000).length
  const metadata = [[c.period, `${row.period_from} / ${row.period_to}`], [c.snapshot, row.snapshot_utc], [c.labels.at(-1), totals.total], [c.cap, capDays]]
  const table = days.map(day => [day.day, ...OUTCOMES.map(key => day[key]), day.total])
  if (format === 'json') return JSON.stringify({ report: SCHEMA, locale, periodFrom: row.period_from, periodToExclusive: row.period_to,
    declaredSnapshotUtc: row.snapshot_utc, title: c.title, limitations: c.limits, emptyNotice: days.length ? null : c.empty, capDays, totals, days }, null, 2) + '\n'
  if (format === 'csv') return [[c.title], [c.limits], ...metadata, ...(days.length ? [] : [[c.empty]]), c.labels, ...table].map(csv).join('\r\n') + '\r\n'
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(c.title)}</title><style>body{font:16px system-ui;max-width:1100px;margin:auto;padding:20px;background:#faf9f6;color:#252722}h1{font-size:1.5rem}p{line-height:1.6}.scroll{overflow:auto}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:8px;text-align:right}th:first-child,td:first-child{text-align:left}</style><h1>${escape(c.title)}</h1><p>${escape(c.limits)}</p>${metadata.map(([key, value]) => `<p>${escape(key)} : ${escape(value)}</p>`).join('')}${days.length ? '' : `<p>${escape(c.empty)}</p>`}<div class="scroll"><table><thead><tr>${c.labels.map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${table.map(values => `<tr>${values.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></html>\n`
}
