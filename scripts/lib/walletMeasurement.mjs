// Operator-only, read-only aggregation. Never imported by the app or Functions.
export const ROW_LIMIT = 100_000
export const SCHEMA = 'arty-wallet-measurement-v1'
const SAFE = Number.MAX_SAFE_INTEGER

function fail() { throw new Error('Rapport indisponible : agrégat absent, incohérent ou hors capacité.') }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail()
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail()
  return parsed.getTime()
}
export function validateWindow(from, to) {
  const days = (date(to) - date(from)) / 86_400_000
  if (!Number.isInteger(days) || days < 1 || days > 31) fail()
  return { from, to, days }
}

export function measurementSQL(from, to) {
  validateWindow(from, to) // Only canonical dates can enter the SQL literals.
  // LIMIT precedes the date filter. Do not materialize raw metadata: classify
  // one source stream and aggregate only small scalars. This is not a RAM/SLA bound.
  return `WITH source AS (
  SELECT amount_micro, provider_cost_micro, kind, meta, created_at
  FROM credit_ledger LIMIT ${ROW_LIMIT + 1}
), dated AS (
  SELECT *, CASE WHEN typeof(created_at) = 'text' AND length(created_at) = 19
    AND datetime(created_at, '+0 seconds') = created_at COLLATE BINARY
    THEN 1 ELSE 0 END AS date_valid
  FROM source
), normalized AS (
  SELECT *, CASE
    WHEN kind <> 'debit' COLLATE BINARY OR date_valid = 0
      OR created_at < '${from} 00:00:00' OR created_at >= '${to} 00:00:00' THEN '{}'
    WHEN meta IS NULL THEN '{}'
    WHEN typeof(meta) = 'text' AND length(CAST(meta AS BLOB)) <= 8192 THEN
      CASE WHEN json_valid(meta) = 1 THEN
        CASE WHEN json_type(meta) = 'object' THEN meta ELSE NULL END
      ELSE NULL END
    ELSE NULL END AS safe_meta
  FROM dated
), indicators AS (
  SELECT *,
    (SELECT type FROM json_each(COALESCE(safe_meta, '{}')) WHERE key = 'usageMeasured' COLLATE BINARY LIMIT 1) AS usage_type,
    (SELECT COUNT(*) FROM json_each(COALESCE(safe_meta, '{}')) WHERE key = 'fallback' COLLATE BINARY) AS fallback_count,
    (SELECT type FROM json_each(COALESCE(safe_meta, '{}')) WHERE key = 'fallback' COLLATE BINARY LIMIT 1) AS fallback_type,
    (SELECT value FROM json_each(COALESCE(safe_meta, '{}')) WHERE key = 'fallback' COLLATE BINARY LIMIT 1) AS fallback_value,
    (SELECT CASE WHEN COUNT(*) <> COUNT(DISTINCT key COLLATE BINARY)
      OR COALESCE(MAX(instr(key, char(0))), 0) > 0 THEN 1 ELSE 0 END
      FROM json_each(COALESCE(safe_meta, '{}'))) AS ambiguous_keys
  FROM normalized
), classified AS MATERIALIZED (
  SELECT CASE WHEN typeof(amount_micro) = 'integer' AND amount_micro BETWEEN -${SAFE} AND 0 THEN amount_micro ELSE NULL END AS safe_amount,
    CASE WHEN typeof(provider_cost_micro) = 'integer' AND provider_cost_micro BETWEEN 0 AND ${SAFE} THEN provider_cost_micro ELSE NULL END AS safe_cost,
    CASE
    WHEN date_valid = 0 THEN 'invalid_date'
    WHEN created_at < '${from} 00:00:00' OR created_at >= '${to} 00:00:00' THEN 'outside'
    WHEN kind IS NULL OR kind <> 'debit' COLLATE BINARY THEN 'other'
    WHEN typeof(amount_micro) <> 'integer' OR amount_micro > 0 OR amount_micro < -${SAFE}
      OR (provider_cost_micro IS NOT NULL AND (typeof(provider_cost_micro) <> 'integer'
        OR provider_cost_micro < 0 OR provider_cost_micro > ${SAFE}))
      OR safe_meta IS NULL OR ambiguous_keys = 1 THEN 'inconsistent'
    WHEN usage_type = 'true' THEN CASE WHEN provider_cost_micro IS NOT NULL
      AND fallback_count = 0 THEN 'measured' ELSE 'inconsistent' END
    WHEN usage_type = 'false' THEN CASE WHEN provider_cost_micro IS NULL AND
      (fallback_count = 0 OR (fallback_type = 'text' AND fallback_value = 'full_reservation' COLLATE BINARY))
      THEN 'unknown' ELSE 'inconsistent' END
    WHEN usage_type IS NULL AND fallback_count = 0 THEN CASE
      WHEN provider_cost_micro IS NULL THEN 'unknown' ELSE 'legacy' END
    ELSE 'inconsistent' END AS category
  FROM indicators
)
SELECT '${SCHEMA}' AS schema, '${from}' AS period_from, '${to}' AS period_to,
  datetime('now') AS snapshot_utc, COUNT(*) AS source_rows,
  COUNT(CASE WHEN category = 'invalid_date' THEN 1 END) AS invalid_date_rows,
  COUNT(CASE WHEN category = 'outside' THEN 1 END) AS outside_rows,
  COUNT(CASE WHEN category = 'other' THEN 1 END) AS other_rows,
  COUNT(CASE WHEN category = 'measured' THEN 1 END) AS measured_rows,
  COUNT(CASE WHEN category = 'legacy' THEN 1 END) AS legacy_rows,
  COUNT(CASE WHEN category = 'unknown' THEN 1 END) AS unknown_rows,
  COUNT(CASE WHEN category = 'inconsistent' THEN 1 END) AS inconsistent_rows,
  CAST(COALESCE(SUM(CASE WHEN category = 'measured' THEN -safe_amount ELSE 0 END), 0) AS TEXT) AS measured_debit_micro,
  CAST(COALESCE(SUM(CASE WHEN category = 'measured' THEN safe_cost ELSE 0 END), 0) AS TEXT) AS measured_cost_micro
FROM classified;`
}

const counters = ['source_rows', 'invalid_date_rows', 'outside_rows', 'other_rows', 'measured_rows', 'legacy_rows', 'unknown_rows', 'inconsistent_rows']
const amounts = ['measured_debit_micro', 'measured_cost_micro']
const fields = ['schema', 'period_from', 'period_to', 'snapshot_utc', ...counters, ...amounts].sort()
function integerText(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(value)) fail()
  const integer = BigInt(value)
  if (integer > BigInt(SAFE)) fail()
  return Number(integer)
}
export function validateAggregate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(fields)) fail()
  if (value.schema !== SCHEMA) fail()
  validateWindow(value.period_from, value.period_to)
  if (typeof value.snapshot_utc !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.snapshot_utc)) fail()
  const stamp = value.snapshot_utc.replace(' ', 'T') + 'Z', parsed = new Date(stamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== stamp.replace('Z', '.000Z')) fail()
  for (const key of counters) if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > ROW_LIMIT) fail()
  if (counters.slice(1).reduce((sum, key) => sum + value[key], 0) !== value.source_rows) fail()
  const debit = integerText(value.measured_debit_micro), cost = integerText(value.measured_cost_micro)
  if (value.measured_rows === 0 && (debit !== 0 || cost !== 0)) fail()
  return { ...value }
}

export function parseAggregate(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 65_536) fail()
  let parsed
  try { parsed = JSON.parse(input) } catch { fail() }
  // Accept the exact one-statement Wrangler result envelope, or a fixture row.
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1 || parsed[0]?.success !== true || !Array.isArray(parsed[0].results) || parsed[0].results.length !== 1) fail()
    parsed = parsed[0].results[0]
  }
  return validateAggregate(parsed)
}

const labels = {
  source_rows: 'Lignes du registre examinées (toutes dates)',
  invalid_date_rows: 'Dates inassignables (registre global, pas un dénominateur de période)',
  outside_rows: 'Lignes datées hors période', other_rows: 'Autres mouvements dans la période',
  measured_rows: 'Débits — usage déclaré mesuré', legacy_rows: 'Débits sans indicateur de mesure — coût connu',
  unknown_rows: 'Débits — coût inconnu', inconsistent_rows: 'Débits incohérents — exclus',
}
export const LIMITATIONS = [
  'Lecture du registre wallet uniquement ; pas des utilisateurs, requêtes ou parcours réussis. Les appels sans règlement réussi et les usages hors wallet sont absents.',
  'Dates des mouvements en UTC, pas des requêtes commencées. Des règlements tardifs peuvent modifier une période passée.',
  'Coût technique enregistré — usage déclaré mesuré par le writer. Calcul tarifaire historique, pas une facture fournisseur ni un coût exhaustif ; pas de recalcul au tarif actuel.',
  'Débit et coût portent sur les mêmes lignes mesurées. Leur écart signé peut être négatif ; ce n’est ni une marge commerciale, ni un revenu.',
  'Micro-USD persistés, sans conversion en euros. Topups, remboursements, chargebacks et autres mouvements ne sont pas des consommations IA.',
  'Plafond global de 100 000 lignes avant filtrage temporel : au-delà le rapport est indisponible. Réduire la période ne résout pas ce plafond ; aucune garantie de coût SQL, RAM ou latence D1.',
  'Activation, succès métier, D7/D30 et conversion : non instrumentés par ce rapport. Aucune nouvelle collecte.',
]
function usd(micro) {
  if (micro === null) return 'Non disponible — aucun débit déclaré mesuré'
  const integer = BigInt(micro), absolute = integer < 0n ? -integer : integer
  return `${integer < 0n ? '-' : ''}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, '0')} USD`
}
const htmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"'

export function renderMeasurement(aggregate, format = 'html', provenance = 'import-unverified') {
  // Always validate again, including when callers pass an already parsed object.
  const row = validateAggregate(aggregate)
  if (!['html', 'csv', 'json'].includes(format) || !['import-unverified', 'fixture'].includes(provenance)) fail()
  const selected = row.measured_rows + row.legacy_rows + row.unknown_rows + row.inconsistent_rows
  const debit = row.measured_rows ? integerText(row.measured_debit_micro) : null
  const cost = row.measured_rows ? integerText(row.measured_cost_micro) : null
  const gap = debit === null ? null : debit - cost
  const sourceLabel = provenance === 'fixture' ? 'Fixture synthétique — aucune donnée réelle' : 'Agrégat importé — origine et extraction D1 non attestées par cet outil'
  const values = [
    ['Période des mouvements UTC', `${row.period_from} inclus → ${row.period_to} exclu`],
    ['Horodatage déclaré du snapshot UTC', row.snapshot_utc], ['Provenance', sourceLabel],
    ...counters.map(key => [labels[key], String(row[key])]),
    ['Couverture des débits datés de la période', selected ? `${row.measured_rows} / ${selected} lignes` : 'Aucun débit daté dans la période'],
    ['Débit du sous-ensemble mesuré', usd(debit)], ['Coût technique enregistré du même sous-ensemble', usd(cost)],
    ['Écart technique signé (pas une marge)', usd(gap)],
  ]
  if (format === 'json') return JSON.stringify({ schema: SCHEMA, provenance, aggregate: row, selectedDebitRows: selected, measuredDebitMicro: debit, measuredCostMicro: cost, technicalDifferenceMicro: gap, limitations: LIMITATIONS }, null, 2) + '\n'
  if (format === 'csv') return [['Mesure', 'Valeur'], ...values, ...LIMITATIONS.map(text => ['Limite', text])].map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n'
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<title>Arty — consommation technique wallet</title></head><body>
<h1>Consommation technique wallet</h1><p>${htmlEscape(sourceLabel)}</p>
<table><caption>Période, échantillon et montants — aucun indicateur commercial</caption><thead><tr><th scope="col">Mesure</th><th scope="col">Valeur</th></tr></thead><tbody>
${values.map(([label, value]) => `<tr><th scope="row">${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join('\n')}
</tbody></table><h2>Limites de lecture</h2><ul>${LIMITATIONS.map(text => `<li>${htmlEscape(text)}</li>`).join('')}</ul>
</body></html>\n`
}
