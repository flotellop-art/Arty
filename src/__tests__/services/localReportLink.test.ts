import { beforeEach, describe, expect, it, vi } from 'vitest'
const session = vi.hoisted(() => ({ owner: 'a' as string | null }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => session.owner }))
import { localReportPath, storedLocalReportPath } from '../../services/localReportLink'
import { prepareAssistantContent } from '../../services/factChecker'

const id = '91fe72b8-8dca-4d4f-a8c0-8184f971f298'
const path = `/report/${id}`
beforeEach(() => {
  localStorage.clear()
  session.owner = 'a'
  localStorage.setItem(`arty-a-report-${id}`, 'v2:encrypted')
})

describe('local report navigation and grounding', () => {
  it('accepts the canonical relative and current-origin routes', () => {
    expect(storedLocalReportPath(path)).toBe(path)
    expect(storedLocalReportPath(`${location.origin}${path}`)).toBe(path)
  })
  it.each([
    `https://evil.test${path}`, `https://localhost.evil.test${path}`,
    `https://user@${location.host}${path}`, `//${location.host}${path}`,
    `${location.origin}:9876${path}`, `/report/invented`, `${path}?export=1`,
    `${path}#secret`, '/api/private', `/other/..${path}`, `${path}/`,
    path.replace('/report/', '/%72eport/'), ` ${path}`, `${path}\n`,
  ])('rejects noncanonical or foreign URL %s', value => {
    expect(localReportPath(value)).toBeNull()
    expect(storedLocalReportPath(value)).toBeNull()
  })
  it('requires a report stored under the active account', () => {
    session.owner = 'b'
    expect(storedLocalReportPath(path)).toBeNull()
    session.owner = null
    expect(storedLocalReportPath(path)).toBeNull()
    session.owner = 'a'
    localStorage.clear()
    expect(storedLocalReportPath(path)).toBeNull()
    expect(localReportPath(path)).toBe(path)
  })
  it('preserves a saved local resource without certifying its facts or other localhost URLs', () => {
    const link = `[Rapport](${location.origin}${path})`
    const prepared = prepareAssistantContent('Ouvre mon rapport', link)
    expect(prepared.content).toBe(link)
    expect(prepareAssistantContent('Ouvre mon rapport', `[API](${location.origin}/api/private)`).content).toContain('non vérifié')
    localStorage.clear()
    expect(prepareAssistantContent('Ouvre mon rapport', link).content).toContain('non vérifié')
  })
})
