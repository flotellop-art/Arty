import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ ready: true, generation: 1, googleReady: false, conversationsReady: false }))
vi.mock('../../services/crypto', () => ({ isCryptoReady: () => state.ready, captureCryptoGuard: () => { const gen = state.generation; return () => gen === state.generation } }))
vi.mock('../../services/googleAuth', () => ({ isGoogleStorageReady: () => state.googleReady, bootstrapGoogleStorage: vi.fn(async () => {}) }))
vi.mock('../../services/storage', () => ({ isCacheReady: () => state.conversationsReady, bootstrapConversationStorage: vi.fn(async () => {}) }))
vi.mock('../../services/secureFileStorage', () => ({ bootstrapFileStorage: vi.fn(async () => {}) }))
import { resumePendingLocalStorage } from '../../services/resumeLocalStorage'
import { bootstrapGoogleStorage } from '../../services/googleAuth'
import { bootstrapConversationStorage } from '../../services/storage'
import { bootstrapFileStorage } from '../../services/secureFileStorage'
beforeEach(() => { vi.clearAllMocks(); state.ready = true; state.generation = 1; state.googleReady = false; state.conversationsReady = false })
describe('resume only interrupted local bootstraps', () => {
  it('restarts all unloaded stores', async () => {
    expect(await resumePendingLocalStorage()).toBe(true)
    expect(bootstrapGoogleStorage).toHaveBeenCalledOnce(); expect(bootstrapConversationStorage).toHaveBeenCalledOnce(); expect(bootstrapFileStorage).toHaveBeenCalledOnce()
  })
  it('does not decrypt already unlocked Google/conversation caches with a changed credential', async () => {
    state.googleReady = true; state.conversationsReady = true
    expect(await resumePendingLocalStorage()).toBe(true)
    expect(bootstrapGoogleStorage).not.toHaveBeenCalled(); expect(bootstrapConversationStorage).not.toHaveBeenCalled(); expect(bootstrapFileStorage).toHaveBeenCalledOnce()
  })
  it('returns optional loading failure without throwing a credential-save error', async () => {
    vi.mocked(bootstrapFileStorage).mockRejectedValueOnce(new Error('IDB unavailable'))
    expect(await resumePendingLocalStorage()).toBe(false)
  })
  it('does not publish a result from an obsolete crypto generation', async () => {
    vi.mocked(bootstrapFileStorage).mockImplementationOnce(async () => { state.generation++ })
    expect(await resumePendingLocalStorage()).toBeNull()
  })
})
