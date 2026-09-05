import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/checkout', () => ({ canPurchase: false, openCheckout: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getStoredUser: () => null }))
vi.mock('../../services/billingClient', () => ({ fetchBillingUsage: vi.fn(async () => ({
  currentMode: 'subscription', windowDays: 30,
  byModel: [{ model: 'claude-sonnet-5', count: 40, providerCostMicro: 1_000_000, creditsMicro: 1_500_000 }],
  byDayCostMicro: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`2026-08-${i + 1}`, 100_000])),
})) }))

import { BillingAdvisorCard } from '../../components/billing/BillingAdvisorCard'

describe('BillingAdvisorCard native', () => {
  it('recommande la configuration BYOK sans offre externe ni comparaison de prix', async () => {
    localStorage.clear()
    const { container } = render(<BillingAdvisorCard />)
    expect(await screen.findByText('advisor.nativeByokNote')).toBeInTheDocument()
    for (const key of ['advisor.estimateNote', 'advisor.threeNumbers', 'advisor.recommend_byok', 'advisor.ctaSubscribe']) {
      expect(screen.queryByText(key)).not.toBeInTheDocument()
    }
    expect(container.querySelector('a')).toBeNull()
  })
})
