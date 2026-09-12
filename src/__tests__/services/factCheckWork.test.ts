import { afterEach, describe, expect, it, vi } from 'vitest'
import { factCheckLots, runFactCheckWork } from '../../services/factCheckWork'
import type { FactCheckResult } from '../../types'
import { proof } from '../fixtures/factEvidence'
import { validFactCheckProgressForResult } from '../../../shared/factCheckEvidence'
import { projectLocalSyncConversationShape } from '../../services/workspaceSync/captureProjection'

const result = (): FactCheckResult => ({ overallConfidence: 'high', claims: [{ claim: 'Fait', verdict: 'verified', explanation: '', review: proof() }], modelLabel: 'test', checkedAt: 1, status: 'success-empty' })
afterEach(() => vi.restoreAllMocks())
describe('bounded fact-check work', () => {
  it('keeps paragraph boundaries without claiming that the four-lot ceiling covers all text', async () => {
    const text = ('x'.repeat(4998) + '\n\n').repeat(4) + 'y'.repeat(4000)
    const outcome = await runFactCheckWork(text, async () => ({ result: result() }))
    expect(outcome.result).toMatchObject({ status: 'partial', coverage: { inputChars: 24_000, submittedChars: 20_000 }, progress: { phase: 'stopped' } })
  })
  it.each([80, 6000, 6001, 6079, 12_003, 24_000, 25_000])('accounts for unique spans and a valid short tail at %i characters', length => {
    const text = 'x'.repeat(length), lots = factCheckLots(text)
    expect(lots.length).toBeLessThanOrEqual(4)
    expect(lots.every(l => l.end - l.start >= 80 && l.end - l.start <= 6000)).toBe(true)
    expect(lots.map(l => text.slice(l.start, l.end)).join('')).toBe(text.slice(0, Math.min(length, 24_000)))
  })
  it('processes full context, retains more than ten claims overall and persists measured progress', async () => {
    const text = 'x'.repeat(12_100), progress: FactCheckResult[] = []
    const run = vi.fn(async (_text, work) => {
      expect(work.context).toBe(text)
      return { result: { ...result(), claims: Array.from({ length: 5 }, () => result().claims[0]!) } }
    })
    const outcome = await runFactCheckWork(text, run, { onProgress: p => progress.push(p) })
    expect(outcome.result?.claims).toHaveLength(15)
    expect(outcome.result?.progress).toMatchObject({ phase: 'complete', accepted: 15, identified: 15, batchesDone: 3 })
    expect(progress.every(validFactCheckProgressForResult)).toBe(true)
    expect(validFactCheckProgressForResult(outcome.result!)).toBe(true)
    const conversation = { id: 'c', title: '', createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'assistant', content: text, timestamp: 1, factCheck: outcome.result }] }
    expect(projectLocalSyncConversationShape(conversation).messages[0]!.factCheck).toEqual(outcome.result)
    expect(() => projectLocalSyncConversationShape({ ...conversation, messages: [{ ...conversation.messages[0], factCheck: { ...outcome.result, progress: { ...outcome.result!.progress, accepted: 16 } } }] })).toThrow()
  })
  it('keeps completed lots on deadline and does not re-arm budget or recovery', async () => {
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now)
    const run = vi.fn(async (_text, work) => { const recovery = work.recoverEvidence; work.recoverEvidence = false; now += 120_000; return { result: { ...result(), modelLabel: String(recovery) } } })
    const outcome = await runFactCheckWork('x'.repeat(24_000), run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(outcome.result).toMatchObject({ status: 'partial', coverage: { submittedChars: 12_000 }, progress: { phase: 'stopped', batchesDone: 2 }, modelLabel: 'true / false' })
  })
  it('stops without publishing a stale result after a concurrent edit', async () => {
    let current = true
    const run = vi.fn(async () => { current = false; return { result: result() } })
    const outcome = await runFactCheckWork('x'.repeat(13_000), run, { isCurrent: () => current })
    expect(outcome.result).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('retains a successful lot after a later provider failure, marking incomplete coverage', async () => {
    const run = vi.fn().mockResolvedValueOnce({ result: result() }).mockResolvedValueOnce({ result: null, reason: 'network' })
    const outcome = await runFactCheckWork('x'.repeat(13_000), run)
    expect(outcome.result).toMatchObject({ status: 'partial', coverage: { submittedChars: 6000 }, progress: { accepted: 1, batchesDone: 1, phase: 'stopped' } })
  })
})
