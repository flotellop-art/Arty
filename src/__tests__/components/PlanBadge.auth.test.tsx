import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  status: {} as Record<string, unknown>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => mocks.status }))
vi.mock('../../services/checkout', () => ({ canPurchase: false }))

import { PlanBadge } from '../../components/chat/PlanBadge'

function baseStatus() {
  return {
    plan: 'free',
    allowedFamilies: ['claude-haiku'],
    lockedFamilies: [],
    dailyRemaining: { 'claude-haiku': 10 },
    dailyLimits: { 'claude-haiku': 10 },
    monthlyCap: null,
    premiumPackRemaining: 0,
    loading: false,
    authRejected: false,
    authRequired: false,
    statusUnavailable: false,
    refresh: mocks.refresh,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status = baseStatus()
})

describe('PlanBadge — identité VIP à réparer', () => {
  it.each([null, {}])('does not invent unlimited quotas or a Pro license for a subscription without caps (%s)', monthlyCap => {
    mocks.status = { ...baseStatus(), plan: 'subscription', monthlyCap }
    render(<PlanBadge />)
    const badge = screen.getByRole('button')
    expect(badge).toHaveTextContent('chat.planBadge.labelSub')
    expect(badge).not.toHaveTextContent('∞')
    expect(badge).toHaveAttribute('title', 'chat.planBadge.titleSubUnknown')
  })
  it('déclenche le vrai flux Google quand le grant manque', () => {
    mocks.status = { ...baseStatus(), authRequired: true }
    const reconnect = vi.fn()
    window.addEventListener('arty-reconnect-google', reconnect)

    render(<PlanBadge />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.planBadge.authRequired' }))

    expect(reconnect).toHaveBeenCalledOnce()
    window.removeEventListener('arty-reconnect-google', reconnect)
  })

  it('réessaie la vérification sans afficher Gratuit après une panne', () => {
    mocks.status = { ...baseStatus(), statusUnavailable: true }

    render(<PlanBadge />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.planBadge.statusUnavailable' }))

    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByText(/labelFree/)).not.toBeInTheDocument()
  })
})
