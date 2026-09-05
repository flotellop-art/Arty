import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ deleteAccount: vi.fn(), wipeLocal: vi.fn(), owner: 'a', epoch: 1 }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/accountService', () => ({ deleteAccount: mocks.deleteAccount, wipeLocalAccount: mocks.wipeLocal }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mocks.owner, getActiveSessionEpoch: () => mocks.epoch }))
import { AccountDeletionPanel } from '../../components/settings/AccountDeletionPanel'
beforeEach(() => { vi.clearAllMocks(); mocks.owner = 'a'; mocks.epoch = 1; mocks.deleteAccount.mockReset(); mocks.wipeLocal.mockReset() })
describe('account erasure confirmation UI', () => {
  it('requires account confirmation, then a separate local-only choice and confirmation after failure', async () => {
    mocks.deleteAccount.mockRejectedValueOnce(new Error('uncertain receipt'))
    const done = vi.fn(); render(<AccountDeletionPanel open onComplete={done} />)
    fireEvent.click(screen.getByText('account.delete'))
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('account.confirmCta'))
    await screen.findByText('account.localChoice')
    expect(mocks.wipeLocal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('account.localChoice'))
    expect(screen.getByText('account.localBody')).toBeVisible()
    expect(mocks.wipeLocal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('account.localConfirm'))
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(mocks.wipeLocal).toHaveBeenCalledTimes(1)
  })
  it('an old A confirmation cannot delete the now active B account', async () => {
    render(<AccountDeletionPanel open onComplete={vi.fn()} />)
    fireEvent.click(screen.getByText('account.delete'))
    mocks.owner = 'b'; mocks.epoch++
    fireEvent.click(screen.getByText('account.confirmCta'))
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.wipeLocal).not.toHaveBeenCalled()
    expect(screen.queryByText('account.confirmCta')).toBeNull()
  })
  it('same-owner retry requires a new arm after cleanup invalidates the prior epoch', async () => {
    mocks.deleteAccount.mockImplementationOnce(async () => { mocks.epoch++; throw new Error('disk') })
    render(<AccountDeletionPanel open onComplete={vi.fn()} />)
    fireEvent.click(screen.getByText('account.delete')); fireEvent.click(screen.getByText('account.confirmCta'))
    await screen.findByText('account.localChoice')
    expect(screen.queryByText('account.confirmCta')).toBeNull()
    fireEvent.click(screen.getByText('account.delete'))
    fireEvent.click(screen.getByText('account.confirmCta'))
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledTimes(2))
  })
  it('closing and reopening disarms the destructive confirmation', () => {
    const { rerender } = render(<AccountDeletionPanel open onComplete={vi.fn()} />)
    fireEvent.click(screen.getByText('account.delete'))
    rerender(<AccountDeletionPanel open={false} onComplete={vi.fn()} />)
    rerender(<AccountDeletionPanel open onComplete={vi.fn()} />)
    expect(screen.queryByText('account.confirmCta')).toBeNull()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })
  it('a failed request after A→B→A does not rearm the old confirmation', async () => {
    let reject!: (reason: Error) => void
    mocks.deleteAccount.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r }))
    render(<AccountDeletionPanel open onComplete={vi.fn()} />)
    fireEvent.click(screen.getByText('account.delete')); fireEvent.click(screen.getByText('account.confirmCta'))
    mocks.owner = 'b'; mocks.epoch++; mocks.owner = 'a'; mocks.epoch++
    reject(new Error('superseded'))
    await screen.findByText('account.error')
    expect(screen.queryByText('account.confirmCta')).toBeNull()
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
  })
})
