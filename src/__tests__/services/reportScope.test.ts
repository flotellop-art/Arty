import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ owner: 'a', epoch: 1, generation: 1, sanitize: vi.fn(), set: vi.fn(), get: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mock.owner, getActiveSessionEpoch: () => mock.epoch, purgeLegacyGlobalReports: () => {} }))
vi.mock('../../services/crypto', () => ({ isCryptoReady: () => true, captureCryptoGuard: () => { const generation = mock.generation; return () => generation === mock.generation }, secureSet: mock.set, secureGet: mock.get }))
vi.mock('dompurify', () => ({ default: { sanitize: mock.sanitize } }))
import { saveReport, getReport } from '../../services/reportGenerator'
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mock.owner = 'a'; mock.epoch = 1; mock.generation = 1; mock.sanitize.mockImplementation(value => value); mock.set.mockResolvedValue(undefined) })
describe('report storage remains with its captured identity', () => {
  it.each(['owner', 'epoch', 'crypto'] as const)('refuses %s changes during sanitization, never writes under the new account', async change => {
    mock.sanitize.mockImplementation(value => { if (change === 'owner') mock.owner = 'b'; if (change === 'epoch') mock.epoch++; if (change === 'crypto') mock.generation++; return value })
    await expect(saveReport('Résumé', '<p>CONTENU A</p>')).rejects.toThrow('Report cancelled')
    expect(mock.set).not.toHaveBeenCalled()
  })
  it('uses distinct fixed owner keys for concurrent reports', async () => {
    const [first, second] = await Promise.all([saveReport('Un', '<p>A</p>'), saveReport('Deux', '<p>B</p>')])
    expect(first).not.toBe(second)
    expect(mock.set.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([`arty-a-report-${first}`, `arty-a-report-${second}`]))
  })
  it('does not return old account content after async decryption', async () => {
    localStorage.setItem('arty-a-report-r', 'v2:encrypted')
    mock.get.mockImplementation(async () => { mock.owner = 'b'; return '<html data-arty-report-hardened="1">SECRET A</html>' })
    await expect(getReport('r')).rejects.toThrow('Report cancelled')
    expect(mock.set).not.toHaveBeenCalled()
  })
})
