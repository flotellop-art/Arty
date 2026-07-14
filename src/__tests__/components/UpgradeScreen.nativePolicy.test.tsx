import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../services/checkout', () => ({
  canPurchase: false,
  SUBSCRIPTION_PORTAL_URL: 'https://tryarty.lemonsqueezy.com/billing',
  openCheckout: vi.fn(),
  openCreemCheckout: vi.fn(),
}))

vi.mock('../../services/googleAuth', () => ({
  getStoredUser: () => null,
  getValidAccessToken: vi.fn(),
}))

vi.mock('../../services/walletClient', () => ({
  fetchWalletBalance: vi.fn(),
}))

vi.mock('../../hooks/usePlanStatus', () => ({
  usePlanStatus: () => ({
    plan: 'subscription',
    allowedFamilies: [],
    lockedFamilies: [],
    dailyRemaining: null,
    dailyLimits: null,
    monthlyCap: null,
    premiumPackRemaining: 0,
    loading: false,
    refresh: vi.fn(),
  }),
}))

import { UpgradeScreen } from '../../screens/upgrade'

describe('UpgradeScreen — politique Android', () => {
  it("masque les offres d'achat mais conserve l'annulation pour un abonné", () => {
    const { container } = render(
      <MemoryRouter>
        <UpgradeScreen onBack={() => {}} currentPlan="subscription" email="user@example.com" />
      </MemoryRouter>,
    )

    expect(screen.getByText('upgrade.nativeUnavailableTitle')).toBeInTheDocument()
    expect(screen.queryByText('upgrade.subscriptionPrice')).not.toBeInTheDocument()
    expect(container.querySelectorAll('a[href*="/checkout/"]')).toHaveLength(0)

    const manage = screen.getByRole('link', { name: 'upgrade.manageSubscription' })
    expect(manage).toHaveAttribute('href', 'https://tryarty.lemonsqueezy.com/billing')
    expect(manage).toHaveAttribute('target', '_blank')
  })
})
