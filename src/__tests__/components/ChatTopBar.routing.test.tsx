import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatTopBar } from '../../components/chat/ChatTopBar'
import type { Conversation } from '../../types'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === 'chat.topBar.lastCall' ? `last:${String(params?.model ?? '')}` : key,
  }),
}))

vi.mock('../../hooks/useSelectedModel', () => ({
  useSelectedModel: () => 'auto',
}))

vi.mock('../../hooks/useReflectionLevel', () => ({
  useReflectionLevel: () => 'auto',
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

vi.mock('../../components/chat/PlanBadge', () => ({
  PlanBadge: () => null,
}))

function conversation(
  id: string,
  model: string,
  reasonCode: string,
  subModelReasonCode?: string
): Conversation {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 2,
    messages: [{
      id: `${id}-assistant`,
      role: 'assistant',
      content: 'Réponse',
      timestamp: 2,
      model,
      reasonCode,
      ...(subModelReasonCode ? { subModelReasonCode } : {}),
    }],
  }
}

beforeEach(() => {
  localStorage.setItem('arty-chat-sheet-v2', '0')
})

describe('ChatTopBar — attribution par conversation', () => {
  it('réhydrate les deux raisons et ne laisse pas un stream concurrent polluer la conversation active', async () => {
    const convA = conversation(
      'conv-a',
      'claude-haiku-4-5-20251001',
      'fallback_no_provider',
      'plan_locked_haiku'
    )
    const convB = conversation('conv-b', 'mistral-medium-latest', 'eu_only')

    const { rerender } = render(
      <ChatTopBar title="A" onBack={() => {}} conversation={convA} />
    )

    const firstAttribution = await screen.findByText('last:Claude Haiku 4.5')
    fireEvent.click(firstAttribution)
    expect(screen.getByText('chat.routeReason.fallback_no_provider')).toBeTruthy()
    expect(screen.getByText('chat.routeReason.plan_locked_haiku')).toBeTruthy()

    rerender(<ChatTopBar title="B" onBack={() => {}} conversation={convB} />)
    await screen.findByText('last:Mistral Medium')
    expect(screen.queryByText('last:Claude Haiku 4.5')).toBeNull()

    act(() => {
      window.dispatchEvent(new CustomEvent('arty-model-used', {
        detail: {
          model: 'gemini-2.5-flash',
          provider: 'gemini',
          conversationId: 'conv-a',
          reason: { code: 'default_capable' },
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByText('last:Mistral Medium')).toBeTruthy()
      expect(screen.queryByText('last:Gemini 2.5 Flash')).toBeNull()
    })
  })
})
