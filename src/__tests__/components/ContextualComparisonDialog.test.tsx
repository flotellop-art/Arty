import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextualComparisonDialog } from '../../components/comparator/ContextualComparisonDialog'
import { ProjectReviewDialog } from '../../components/chat/ProjectReviewDialog'
import type { useContextualComparisons } from '../../hooks/useContextualComparisons'
import i18n from '../../i18n'

describe('contextual comparison modal focus', () => {
  it('only the top review owns Escape; Tab recovers from its removed focus target while documents are pending', () => {
    const cancel = vi.fn(), answer = vi.fn(), start = vi.fn(async () => null)
    const selection = { sourceId: 'source', provider: 'anthropic' as const, question: 'FIRST QUESTION', busy: false,
      panels: [{ id: 'a', provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' }, { id: 'b', provider: 'anthropic' as const, modelId: 'claude-sonnet-5' }] }
    const controller = { selection, cancel, start, getAccess: () => null, getQuota: () => ({ key: 'compare.context.quotaUnknown' }) } as unknown as ReturnType<typeof useContextualComparisons>
    const request = { kind: 'confirm' as const, provider: 'claude' as const, question: 'FIRST QUESTION', systemPrompt: 'RULES', historyMessages: 1, files: [], textChars: 12, binaryBytes: 0, context: null,
      comparisonModels: ['Haiku', 'Sonnet'] as [string, string] }
    const contents = (busy = false, review = false) => <><button>Behind</button><ContextualComparisonDialog controller={{ ...controller, selection: { ...selection, busy } }} onStarted={() => {}} />
      {review && <ProjectReviewDialog request={request} onAnswer={answer} />}</>
    const view = render(contents())
    const prepare = screen.getByRole('button', { name: i18n.t('compare.context.prepare') })
    prepare.focus(); fireEvent.click(prepare)
    view.rerender(contents(true, true))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(answer).toHaveBeenCalledExactlyOnceWith(null); expect(cancel).not.toHaveBeenCalled()
    view.rerender(contents(true, false))
    fireEvent.keyDown(document, { key: 'Tab' })
    const cancelButton = screen.getByRole('button', { name: i18n.t('common.cancel') })
    expect(document.activeElement).toBe(cancelButton)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancelButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1); view.unmount()
  })
})
