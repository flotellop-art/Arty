// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA } from '../../scripts/lib/walletMeasurement.mjs'

const folders = [], ownedFiles = []
const cli = resolve('scripts/wallet-measurement.mjs')
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000 })
const sample = { schema: SCHEMA, period_from: '2026-09-01', period_to: '2026-10-01', snapshot_utc: '2026-09-06 11:00:00', source_rows: 1, invalid_date_rows: 0, outside_rows: 0, other_rows: 0, measured_rows: 1, legacy_rows: 0, unknown_rows: 0, inconsistent_rows: 0, measured_debit_micro: '300000', measured_cost_micro: '200000' }
function folder() { const path = mkdtempSync(join(tmpdir(), 'arty-wallet-report-test-')); folders.push(path); return path }
function file(directory, name, content) { const path = join(directory, name); writeFileSync(path, content, { flag: 'wx' }); ownedFiles.push(path); return path }
afterEach(() => {
  // Only exact files created by these fixtures; no recursive delete or user data.
  for (const path of ownedFiles.splice(0)) unlinkSync(path)
  for (const path of folders.splice(0)) rmdirSync(path)
})

describe('offline wallet report operator CLI', () => {
  it('emits one read-only SQL statement and rejects missing/duplicate/unknown flags', () => {
    const result = run('sql', '--from', '2026-09-01', '--to', '2026-10-01')
    expect(result.status).toBe(0); expect(result.stderr).toBe('')
    expect(result.stdout).toContain('FROM credit_ledger LIMIT 100001')
    expect(result.stdout.match(/;/g)).toHaveLength(1)
    expect(result.stdout).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)\b/i)
    for (const args of [[], ['sql'], ['sql', '--from', '2026-09-01', '--from', '2026-09-01'], ['sql', '--force', 'true'], ['render', '--input']]) {
      const failed = run(...args)
      expect(failed.status).toBe(1); expect(failed.stdout).toBe(''); expect(failed.stderr).toContain('indisponible')
    }
  })

  it('renders the same imported snapshot in all formats without a network operation', () => {
    const sql = run('sql', '--from', '2026-09-01', '--to', '2026-10-01')
    expect(sql.status).toBe(0)
    const db = new DatabaseSync(':memory:')
    let aggregate
    try {
      db.exec(`CREATE TABLE credit_ledger(amount_micro INTEGER,provider_cost_micro INTEGER,kind TEXT,meta TEXT,created_at TEXT);
        INSERT INTO credit_ledger VALUES(-300000,200000,'debit','{"usageMeasured":true}','2026-09-05 12:00:00'); PRAGMA query_only=ON`)
      aggregate = db.prepare(sql.stdout).get()
    } finally { db.close() }
    const directory = folder(), input = file(directory, 'aggregate.json', JSON.stringify([{ success: true, results: [aggregate], meta: { rows_read: 1 } }]))
    for (const format of ['html', 'csv', 'json']) {
      const result = run('render', '--input', input, '--format', format)
      expect(result.status).toBe(0); expect(result.stderr).toBe('')
      expect(result.stdout).toContain(format === 'json' ? 'import-unverified' : 'non attestées')
      expect(result.stdout).toContain(format === 'json' ? '300000' : '0.300000 USD')
      expect(result.stdout).toContain(aggregate.snapshot_utc)
    }
  })

  it('never overwrites an existing output or exposes invalid input in diagnostics', () => {
    const directory = folder(), input = file(directory, 'PRIVATE-INPUT.json', JSON.stringify(sample))
    const output = file(directory, 'report.html', 'EXISTING USER FILE')
    const blocked = run('render', '--input', input, '--format', 'html', '--output', output)
    expect(blocked.status).toBe(1); expect(readFileSync(output, 'utf8')).toBe('EXISTING USER FILE')
    expect(blocked.stderr).not.toContain(directory)
    const bad = file(directory, 'PII-CANARY.json', '{"email":"PII-CANARY@example.test"}')
    const failed = run('render', '--input', bad, '--format', 'html')
    expect(failed.status).toBe(1); expect(failed.stdout).toBe(''); expect(failed.stderr).not.toMatch(/PII-CANARY|email|PRIVATE-INPUT/)
  })

  it('creates a requested new report and refuses oversized input before rendering', () => {
    const directory = folder(), input = file(directory, 'aggregate.json', JSON.stringify(sample)), output = join(directory, 'new-report.html')
    const result = run('render', '--input', input, '--format', 'html', '--output', output)
    expect(result.status).toBe(0); ownedFiles.push(output)
    expect(readFileSync(output, 'utf8')).toContain('Consommation technique wallet')
    const oversized = file(directory, 'oversized.json', ' '.repeat(65_537))
    expect(run('render', '--input', oversized, '--format', 'html').status).toBe(1)
  })
})
