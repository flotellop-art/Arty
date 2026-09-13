import { beforeEach, describe, expect, it, vi } from 'vitest'
const session = vi.hoisted(() => ({ owner: 'a' as string | null }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => session.owner }))
import { storedLocalReportPath } from '../../services/localReportLink'
import { prepareAssistantContent } from '../../services/factChecker'
const id = '91fe72b8-8dca-4d4f-a8c0-8184f971f298'
const path = `/report/${id}`
beforeEach(() => { localStorage.clear(); session.owner = 'a'; localStorage.setItem(`arty-a-report-${id}`, 'encrypted') })
describe('stored local report navigation', () => {
  it('accepts the saved current-account report in the current origin', () => {
    expect(storedLocalReportPath(path)).toBe(path)
    expect(storedLocalReportPath(`${location.origin}${path}`)).toBe(path)
  })
  it.each([`https://evil.test${path}`, `/report/invented`, `${path}?export=1`, `${path}#secret`, '/api/private', `https://user@${location.host}${path}`])('rejects %s', value => {
    expect(storedLocalReportPath(value)).toBeNull()
  })
  it('does not preserve a missing report or another account report', () => {
    session.owner = 'b'; expect(storedLocalReportPath(path)).toBeNull()
    session.owner = null; expect(storedLocalReportPath(path)).toBeNull()
    session.owner = 'a'; localStorage.clear(); expect(storedLocalReportPath(path)).toBeNull()
  })
  it('preserves the saved link without certifying external or invented links', () => {
    const link = `[Rapport](${location.origin}${path})`
    expect(prepareAssistantContent('Ouvre mon rapport', link).content).toBe(link)
    localStorage.clear()
    expect(prepareAssistantContent('Ouvre mon rapport', link).content).toContain('non vérifié')
  })
})
