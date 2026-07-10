import { describe, expect, it } from 'vitest'
import { classifyPremiumModel } from '../../../functions/api/_lib/checkPremiumCap'

describe('premium model classification stays aligned with exposed models', () => {
  it.each([
    ['claude-sonnet-5', 'claude-sonnet'],
    ['claude-opus-4-8', 'claude-sonnet'],
    ['gpt-5', 'gpt-5'],
    ['gpt-5.5', 'gpt-5'],
    ['gemini-2.5-pro', 'gemini-pro'],
    ['gemini-pro-latest', 'gemini-pro'],
    ['gemini-3.1-pro-preview', 'gemini-pro'],
    ['gpt-image-1', 'gpt-image'],
    ['flux-2-pro', 'gpt-image'],
  ])('classifies exposed premium model %s', (model, bucket) => {
    expect(classifyPremiumModel(model)?.bucket).toBe(bucket)
  })

  it.each([
    'claude-haiku-4-5-20251001',
    'gpt-5-mini',
    'gpt-5.5-mini',
    'gpt-5-nano',
    'gemini-2.5-flash',
    'gemini-3.5-flash',
    'mistral-medium-latest',
  ])('keeps standard model %s outside the premium cap', (model) => {
    expect(classifyPremiumModel(model)).toBeNull()
  })

  it('fails closed for an unknown model variant', () => {
    expect(classifyPremiumModel('gemini-99-ultra')).toMatchObject({
      bucket: 'unknown-model',
      cap: 80,
    })
  })
})
