import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { getCustomInstructions, setCustomInstructions } from '../../services/customInstructions'
import * as scoped from '../../services/scopedStorage'
import * as instructions from '../../services/customInstructions'
import * as crypt from '../../services/crypto'
import { deferred } from '../helpers/workspaceLocks'
import { blockProjectOperations } from '../../services/projects/localErasureGuard'
import * as waits from '../../services/localMemoryWait'

// Regressions of the production reader/setter, with real WebCrypto.
// These assertions describe durable user content, never a plaintext fallback.
const INSTRUCTIONS = 'Vouvoie-moi.\nRéponds en français, avec les unités m² et €. 🧱'
beforeEach(async () => { await resetCalendarFixture() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function ciphertext() {
  await vi.waitFor(() => expect(scoped.getItem('custom-instructions')).toMatch(/^v[12]:/))
}

describe('personal instructions survive their actual encryption', () => {
  it('returns the exact instructions after the real ciphertext replaces JSON', async () => {
    await setCustomInstructions(INSTRUCTIONS)
    await ciphertext()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe(INSTRUCTIONS)
    expect(getCustomInstructions()).toBe(INSTRUCTIONS)
  })

  it('does not erase the saved instructions in the settings reader-to-blur round trip', async () => {
    await setCustomInstructions(INSTRUCTIONS)
    await ciphertext()
    const displayedOnReopen = getCustomInstructions()
    // The existing SettingsModal passes this displayed value back on blur.
    // This service-level reproduction is not a full rendered UI receipt.
    await setCustomInstructions(displayedOnReopen)
    await ciphertext()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe(INSTRUCTIONS)
    expect(getCustomInstructions()).toBe(INSTRUCTIONS)
  })
})

describe('instruction persistence boundaries', () => {
  it('does not let a read started before a write failure rearm the new write generation', async () => {
    await setCustomInstructions('Original')
    const gate = deferred<void>(), reached = deferred<void>(), realWait = waits.waitForLocalMemory
    const wait = vi.spyOn(waits, 'waitForLocalMemory').mockImplementationOnce(async work => {
      const value = await realWait(work); reached.resolve(); await gate.promise; return value
    })
    const oldRead = instructions.bootstrapCustomInstructions().then(() => false, () => true)
    await reached.promise
    vi.spyOn(scoped, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    await expect(setCustomInstructions('Rejected')).rejects.toThrow()
    gate.resolve(); expect(await oldRead).toBe(true)
    await expect(setCustomInstructions('Must reread first')).rejects.toThrow()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Original')
    wait.mockRestore(); await instructions.bootstrapCustomInstructions(); await setCustomInstructions('After new read')
    expect(getCustomInstructions()).toBe('After new read')
  })
  it('reloads exact Unicode multiline ciphertext without an in-memory cache', async () => {
    await setCustomInstructions(INSTRUCTIONS)
    const raw = scoped.getItem('custom-instructions')
    instructions.resetCustomInstructionsCache()
    expect(instructions.getCustomInstructionsSnapshot().status).toBe('idle')
    await instructions.bootstrapCustomInstructions()
    expect(getCustomInstructions()).toBe(INSTRUCTIONS)
    expect(scoped.getItem('custom-instructions')).toBe(raw)
  })
  it('preserves long historical content on read and writes only ciphertext for explicit edits and clears', async () => {
    const historical = INSTRUCTIONS.repeat(20)
    scoped.setItem('custom-instructions', await crypt.encrypt(JSON.stringify(historical)))
    await instructions.bootstrapCustomInstructions()
    expect(getCustomInstructions()).toBe(historical)
    const write = vi.spyOn(scoped, 'setItem')
    await setCustomInstructions('N'.repeat(800)); expect(getCustomInstructions()).toBe('N'.repeat(500))
    await setCustomInstructions(''); expect(await scoped.secureGetJSON('custom-instructions')).toBe('')
    expect(write.mock.calls).toHaveLength(2)
    for (const [key, raw] of write.mock.calls) { expect(key).toBe('custom-instructions'); expect(raw).toMatch(/^v2:/) }
  })
  it('does not permit a later encryption to overtake an earlier requested edit', async () => {
    await setCustomInstructions('Original')
    const gate = deferred<void>(), real = crypt.encrypt
    const encryption = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async text => { const cipher = await real(text); await gate.promise; return cipher })
    const first = setCustomInstructions('First'), second = setCustomInstructions('Second')
    await vi.waitFor(() => expect(encryption).toHaveBeenCalledOnce())
    expect(getCustomInstructions()).toBe('Original')
    gate.resolve(); await Promise.all([first, second])
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Second')
  })
  it('rejects a whole-text editor based on an older same-account snapshot', async () => {
    await setCustomInstructions('Original')
    const base = instructions.getCustomInstructionsSnapshot()
    await setCustomInstructions('Newer', undefined, base)
    await expect(setCustomInstructions('Stale draft', undefined, base)).rejects.toThrow()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Newer')
  })
  it.each(['v2:corrupt', 'not json', 'null', '{"not":"text"}'])('never turns unreadable storage into an editable empty value: %s', async raw => {
    scoped.setItem('custom-instructions', raw)
    await expect(instructions.bootstrapCustomInstructions()).rejects.toThrow()
    expect(instructions.getCustomInstructionsSnapshot().status).toBe('unavailable')
    await expect(setCustomInstructions('')).rejects.toThrow()
    expect(scoped.getItem('custom-instructions')).toBe(raw)
  })
  it('preserves stored text when the key is wrong and recovers without rewriting it', async () => {
    await setCustomInstructions(INSTRUCTIONS); const raw = scoped.getItem('custom-instructions')
    await crypt.initCrypto('wrong-synthetic-key')
    await expect(instructions.bootstrapCustomInstructions()).rejects.toThrow()
    await expect(setCustomInstructions('Wrong-key replacement')).rejects.toThrow()
    expect(scoped.getItem('custom-instructions')).toBe(raw)
    await crypt.initCrypto('synthetic-calendar-key'); await instructions.bootstrapCustomInstructions()
    expect(getCustomInstructions()).toBe(INSTRUCTIONS); expect(scoped.getItem('custom-instructions')).toBe(raw)
  })
  it.each(['owner-ABA', 'erasure'] as const)('retires pending and queued writes after %s', async change => {
    await setCustomInstructions(INSTRUCTIONS); const raw = scoped.getItem('custom-instructions')
    const gate = deferred<void>(), real = crypt.encrypt
    const encryption = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async text => { const cipher = await real(text); await gate.promise; return cipher })
    const first = setCustomInstructions('Late A').then(() => false, () => true)
    const second = setCustomInstructions('Queued A').then(() => false, () => true)
    await vi.waitFor(() => expect(encryption).toHaveBeenCalledOnce())
    let release = () => {}
    if (change === 'owner-ABA') {
      await installCalendarAccount('b'); expect(scoped.getItem('custom-instructions')).toBeNull()
      await installCalendarAccount('a')
    } else release = blockProjectOperations('a')
    gate.resolve(); expect(await Promise.all([first, second])).toEqual([true, true]); release()
    expect(scoped.getItem('custom-instructions')).toBe(raw)
  })
  it('preserves previous bytes on quota failure and requires a new read before retry', async () => {
    await setCustomInstructions(INSTRUCTIONS); const raw = scoped.getItem('custom-instructions')
    const write = vi.spyOn(scoped, 'setItem').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError') })
    await expect(setCustomInstructions('Updated')).rejects.toThrow()
    expect(scoped.getItem('custom-instructions')).toBe(raw); expect(getCustomInstructions()).toBe(INSTRUCTIONS)
    await expect(setCustomInstructions('Updated')).rejects.toThrow(); expect(write).toHaveBeenCalledOnce()
    await instructions.bootstrapCustomInstructions(); await setCustomInstructions('Updated')
    expect(getCustomInstructions()).toBe('Updated')
  })
  it('retains a committed write after lost acknowledgement and cancels its already queued successor', async () => {
    await setCustomInstructions('Original'); const real = scoped.setItem
    const write = vi.spyOn(scoped, 'setItem').mockImplementationOnce((key, value) => { real(key, value); throw new Error('lost acknowledgement') })
    const first = setCustomInstructions('Actually committed').then(() => false, () => true)
    const second = setCustomInstructions('Must not overwrite').then(() => false, () => true)
    expect(await Promise.all([first, second])).toEqual([true, true]); expect(write).toHaveBeenCalledOnce()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Actually committed')
    await instructions.bootstrapCustomInstructions(); expect(getCustomInstructions()).toBe('Actually committed')
  })
  it('rejects changed source bytes during encryption without overwriting the external value', async () => {
    await setCustomInstructions('Original')
    const external = await crypt.encrypt(JSON.stringify('External')), gate = deferred<void>(), real = crypt.encrypt
    const encryption = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async text => { const cipher = await real(text); await gate.promise; return cipher })
    const write = setCustomInstructions('My obsolete edit').then(() => false, () => true)
    await vi.waitFor(() => expect(encryption).toHaveBeenCalledOnce()); scoped.setItem('custom-instructions', external)
    gate.resolve(); expect(await write).toBe(true); expect(scoped.getItem('custom-instructions')).toBe(external)
    await instructions.bootstrapCustomInstructions(); expect(getCustomInstructions()).toBe('External')
  })
})
