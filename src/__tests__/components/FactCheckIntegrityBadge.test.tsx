import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FactCheckBadge } from '../../components/chat/FactCheckBadge'
import i18n from '../../i18n'
import { proof } from '../fixtures/factEvidence'
afterEach(cleanup)
describe('partial fact-check display', () => {
  it('distinguishes analysis finished from full confirmation and retains accepted claim icons', async () => {
    await i18n.changeLanguage('fr')
    const { container } = render(<FactCheckBadge result={{ overallConfidence: 'medium', modelLabel: 'Sonnet', checkedAt: 1, status: 'partial', limitations: ['evidence_missing'],
      coverage: { inputChars: 500, submittedChars: 500, claimLimitReached: false },
      progress: { phase: 'complete', batchesDone: 1, batchesTotal: 1, accepted: 1, identified: 2 },
      claims: [{ claim: 'Un fait prouvé', verdict: 'verified', explanation: '', review: proof() }, { claim: 'Un point sans preuve', verdict: 'uncertain', explanation: '' }] }} />)
    expect(screen.getByRole('status').textContent).toContain('Analyse terminée')
    expect(screen.getByRole('status').textContent).toContain('1/2')
    expect(screen.getByRole('button').textContent).toContain('partielle')
    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector('.text-emerald-700')?.textContent).toContain('Un fait prouvé')
  })
  it('shows the exact evidence, its context and the independent objection', async () => {
    await i18n.changeLanguage('fr')
    render(<FactCheckBadge result={{ overallConfidence: 'low', modelLabel: 'Sonnet', checkedAt: 1, status: 'partial', limitations: ['evidence_missing'],
      claims: [{ claim: 'Un point sensible', verdict: 'wrong', explanation: '', review: proof({ sensitive: true, status: 'contested', challenge: 'rejected', challengerModel: 'gemini-3.8-flash' }) }] }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/Correction contestée par gemini-3.8-flash/)).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/source')
    expect(screen.getByText('Contexte avant. Extrait synthétique de la source. Contexte après.')).toBeTruthy()
    expect(screen.getByText(/pas de publication/)).toBeTruthy()
  })
  it.each(['fr', 'en'])('shows missing coverage even with no claims in %s', async language => {
    await i18n.changeLanguage(language)
    render(<FactCheckBadge result={{ overallConfidence: 'high', claims: [], modelLabel: 'Haiku', checkedAt: 1, status: 'partial',
      limitations: ['response_truncated', 'claim_limit'], coverage: { inputChars: 7000, submittedChars: 6000, claimLimitReached: true } }} />)
    const button = screen.getByRole('button')
    expect(button.textContent).not.toContain('✓')
    fireEvent.click(button)
    expect(screen.getByRole('note').textContent).toContain('6000')
    expect(screen.getByRole('note').textContent).toContain('7000')
    expect(screen.queryByText(i18n.t('chat.factCheck.noRiskyDetail'))).toBeNull()
  })
  it('does not render a proposed correction as already applied on a partial result', async () => {
    await i18n.changeLanguage('fr')
    const { container } = render(<FactCheckBadge result={{ overallConfidence: 'high', modelLabel: 'Haiku', checkedAt: 1, status: 'partial', limitations: ['search_unavailable'],
      claims: [{ claim: 'Un point', verdict: 'wrong', explanation: '', originalText: 'une valeur initiale', correction: 'une valeur proposée', applied: false }] }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector('.line-through')).toBeNull()
    expect(screen.getByText(/une valeur proposée/)).toBeTruthy()
    expect(screen.getByText(/une valeur proposée/).className).toContain('text-amber')
    expect(screen.getByText(/une valeur proposée/).textContent).toContain('proposition à vérifier')
  })
})
