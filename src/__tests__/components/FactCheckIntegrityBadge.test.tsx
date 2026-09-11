import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FactCheckBadge } from '../../components/chat/FactCheckBadge'
import i18n from '../../i18n'
afterEach(cleanup)
describe('partial fact-check display', () => {
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
