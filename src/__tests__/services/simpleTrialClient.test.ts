import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCalendarFixture, installCalendarAccount } from '../helpers/calendarFixture'
import { captureBillingContext } from '../../services/billingContext'
import { publishPaidFeatures, clearPaidFeatures, hasPaidServerFeatures } from '../../services/paidFeatures'
import { maybeExtractMemory, setAutoMemoryEnabled } from '../../services/autoMemory'
import { isProactiveBriefEnabled, setProactiveBriefEnabled } from '../../services/proactiveBriefSettings'
import { compressIfNeeded } from '../../services/conversationCompressor'
import { enhancePrompt, canEnhancePrompt } from '../../services/promptEnhancer'
import { addFact, getAll, buildLocalMemoryPrompt } from '../../services/localMemoryService'
import * as trial from '../../services/trialClient'
import type { Conversation } from '../../types'
vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'server-provided', getMistralKey: () => null, hasMistralKey: () => false }))
beforeEach(async () => { await resetCalendarFixture(); clearPaidFeatures(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { clearPaidFeatures(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const conversation: Conversation = { id: 'simple-trial', title: 'Synthetic', createdAt: 1, updatedAt: 1,
  messages: Array.from({ length: 9 }, (_, i) => ({ id: String(i), role: 'user', content: 'Synthetic preference '.repeat(30), timestamp: i })) }
describe('free trial keeps manual memory, without extra AI calls', () => {
  it.each([30, 24, 1, 0, null])('does not extract memory at remaining=%s, even with an old ON setting', async remaining => {
    vi.spyOn(trial, 'getTrialRemaining').mockReturnValue(remaining)
    setAutoMemoryEnabled(true); await maybeExtractMemory(conversation)
    expect(fetch).not.toHaveBeenCalled(); expect(getAll()).toEqual([])
  })
  it('stores exact manual facts locally and includes them in the current prompt without fetching', async () => {
    const fact = await addFact('Je préfère des réponses courtes.')
    expect(fact?.content).toBe('Je préfère des réponses courtes.')
    expect(buildLocalMemoryPrompt()).toContain(fact!.content); expect(fetch).not.toHaveBeenCalled()
  })
  it('does not trust a stale VIP cache or a saved brief preference', () => {
    localStorage.setItem('arty-plan-cache', 'vip'); setProactiveBriefEnabled(true)
    expect(hasPaidServerFeatures()).toBe(false); expect(isProactiveBriefEnabled()).toBe(false)
  })
  it('binds verified paid background rights to the actual account epoch', async () => {
    publishPaidFeatures(captureBillingContext(), 'subscription')
    expect(hasPaidServerFeatures()).toBe(true)
    await installCalendarAccount('b'); expect(hasPaidServerFeatures()).toBe(false)
    await installCalendarAccount('a'); expect(hasPaidServerFeatures()).toBe(false)
  })
  it('keeps the full conversation instead of spending the last trial on compression', async () => {
    vi.spyOn(trial, 'getTrialRemaining').mockReturnValue(1)
    const messages = Array.from({ length: 30 }, () => ({ role: 'user' as const, content: 'Synthetic '.repeat(2000) }))
    expect(await compressIfNeeded(messages, undefined, 'server-provided')).toBe(messages)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses enhancement before fetching or treating the server sentinel as a personal key', async () => {
    expect(canEnhancePrompt()).toBe(false)
    await expect(enhancePrompt('Synthetic prompt')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
