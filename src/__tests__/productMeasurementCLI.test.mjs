// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SCHEMA } from '../../scripts/lib/productMeasurement.mjs'
const cli = resolve('scripts/product-measurement.mjs'), folders = [], files = []
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000 })
const sample = { schema: SCHEMA, period_from: '2026-09-01', period_to: '2026-09-07', snapshot_utc: '2026-09-06 11:00:00', days_json: '[]' }
const folder = () => { const path = mkdtempSync(join(tmpdir(), 'arty-product-report-test-')); folders.push(path); return path }
const file = (path, text) => { writeFileSync(path, text, { flag: 'wx' }); files.push(path); return path }
afterEach(() => { for (const path of files.splice(0)) unlinkSync(path); for (const path of folders.splice(0)) rmdirSync(path) })

it('emits only SELECT, rejects missing/duplicate/unknown flags without a fake zero', () => {
  const sql = run('sql', '--from', '2026-09-01', '--to', '2026-10-01')
  expect(sql.status).toBe(0); expect(sql.stdout).toContain('LIMIT 32'); expect(sql.stdout).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)\b/i)
  for (const args of [[], ['sql'], ['sql', '--from', '2026-09-01', '--from', '2026-09-01'], ['sql', '--force', 'true'], ['render', '--input']]) {
    const failed = run(...args); expect(failed.status).toBe(1); expect(failed.stdout).toBe(''); expect(failed.stderr).toContain('indisponible')
  }
})
it('renders the same imported snapshot in FR and EN, without overwriting a file', () => {
  const directory = folder(), input = file(join(directory, 'input.json'), JSON.stringify([{ success: true, results: [sample] }]))
  for (const locale of ['fr', 'en']) for (const format of ['html', 'csv', 'json']) {
    const result = run('render', '--input', input, '--format', format, '--locale', locale)
    expect(result.status).toBe(0); expect(result.stdout).toContain(locale === 'fr' ? 'usage réel inconnu' : 'actual use is unknown')
    expect(result.stdout).toContain(sample.snapshot_utc)
  }
  const existing = file(join(directory, 'report.html'), 'USER FILE')
  expect(run('render', '--input', input, '--format', 'html', '--output', existing).status).toBe(1)
  expect(readFileSync(existing, 'utf8')).toBe('USER FILE')
  const output = join(directory, 'new.html')
  expect(run('render', '--input', input, '--format', 'html', '--output', output).status).toBe(0); files.push(output)
  expect(readFileSync(output, 'utf8')).toContain('Déclarations facultatives')
})
it('rejects oversized or private imports without echoing fields or paths', () => {
  const directory = folder()
  for (const [name, text] of [['large.json', ' '.repeat(65_537)], ['PRIVATE.json', '{"email":"PRIVATE@example.invalid"}']]) {
    const input = file(join(directory, name), text), result = run('render', '--input', input, '--format', 'html')
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).not.toContain(directory); expect(result.stderr).not.toContain('PRIVATE')
  }
})
