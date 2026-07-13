import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GmailSearchPayload } from '../../types'

const mocks = vi.hoisted(() => ({
  copy: vi.fn(async () => {}),
  copyThenOpen: vi.fn(async () => {}),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { value?: string }) => params?.value ? `${key}:${params.value}` : key,
  }),
}))

vi.mock('../../services/gmailSearchHandoff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/gmailSearchHandoff')>()
  return {
    ...actual,
    copyGmailSearch: mocks.copy,
    copyThenOpenGmail: mocks.copyThenOpen,
  }
})

import { GmailSearchCard } from '../../components/gmail/GmailSearchCard'

const payload: GmailSearchPayload = {
  type: 'gmail_search',
  version: 1,
  query: 'from:Paul subject:devis',
  assumptions: [{ kind: 'date', label: 'juin 2026' }],
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
}

describe('GmailSearchCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('affiche la promesse honnête et une requête éditable', async () => {
    const user = userEvent.setup()
    render(<GmailSearchCard content="Préparation locale" payload={payload} />)

    expect(screen.getByText('gmailSearch.noGlobalAccess')).toBeInTheDocument()
    expect(screen.getByText('gmailSearch.privacy')).toBeInTheDocument()
    expect(screen.getByText('gmailSearch.assumption:juin 2026')).toBeInTheDocument()

    const query = screen.getByLabelText('gmailSearch.queryLabel')
    await user.clear(query)
    await user.type(query, 'from:Marie is:unread')
    await user.click(screen.getByRole('button', { name: 'gmailSearch.copy' }))
    expect(mocks.copy).toHaveBeenCalledWith('from:Marie is:unread')
  })

  it('désactive le double clic pendant la copie + ouverture', async () => {
    let resolve!: () => void
    mocks.copyThenOpen.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    const user = userEvent.setup()
    render(<GmailSearchCard content="Préparation locale" payload={payload} />)

    const button = screen.getByRole('button', { name: 'gmailSearch.open' })
    await user.click(button)
    expect(button).toBeDisabled()
    expect(mocks.copyThenOpen).toHaveBeenCalledTimes(1)
    resolve()
  })

  it('désactive une préparation expirée', () => {
    render(<GmailSearchCard
      content="Préparation locale"
      payload={{ ...payload, expiresAt: Date.now() - 1 }}
    />)
    expect(screen.getByRole('button', { name: 'gmailSearch.open' })).toBeDisabled()
    expect(screen.getByText('gmailSearch.status.expired')).toBeInTheDocument()
  })
})
