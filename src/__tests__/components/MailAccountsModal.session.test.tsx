import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn(), t: (key: string) => key }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: f.t }) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ listAccounts: f.list, addAccount: f.add, removeAccount: f.remove }),
}))
import { MailAccountsModal } from '../../components/settings/MailAccountsModal'
import * as users from '../../services/userSession'
import * as cryptoService from '../../services/crypto'
import { resetMailAccountsCache } from '../../services/mailAccounts'

const account = { id: 'synthetic-old', provider: 'imap', email: 'old@example.test', label: 'Synthetic', host: 'example.test' }
const session = (userId: string) => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  users.setActiveSession(session('mail-modal-a')); await cryptoService.initCrypto('synthetic-local-key')
  resetMailAccountsCache(); f.list.mockReset().mockResolvedValue({ accounts: [] })
  f.add.mockReset().mockResolvedValue({ id: 'new', messageCount: 0 }); f.remove.mockReset().mockResolvedValue({})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function enterAccount(email = 'new@example.test') {
  fireEvent.change(screen.getByPlaceholderText('mailAccountsModal.emailPlaceholder'), { target: { value: email } })
  fireEvent.change(screen.getByPlaceholderText('mailAccountsModal.passwordPlaceholder'), { target: { value: 'synthetic-app-password' } })
  fireEvent.click(screen.getByRole('checkbox'))
}
async function openModal() {
  const close = vi.fn(), view = render(<MailAccountsModal open onClose={close} />)
  await waitFor(() => expect(f.list).toHaveBeenCalledTimes(1))
  return { ...view, close }
}

describe('Mail configuration opening lifetime', () => {
  it('requires positive consent, blocks double mutation and never calls HTTP', async () => {
    f.list.mockResolvedValue({ accounts: [account] })
    const held = deferred<{ id: string; messageCount: number }>(); f.add.mockReturnValue(held.promise)
    await openModal(); await screen.findByText(account.email)
    expect(screen.getByText('mailAccountsModal.addButton')).toBeDisabled()
    enterAccount()
    const add = screen.getByText('mailAccountsModal.addButton')
    fireEvent.click(add); fireEvent.click(add)
    fireEvent.click(screen.getByText('mailAccountsModal.remove'))
    await waitFor(() => expect(f.add).toHaveBeenCalledTimes(1))
    expect(f.remove).not.toHaveBeenCalled()
    await act(async () => { held.resolve({ id: 'new', messageCount: 0 }); await held.promise })
    await waitFor(() => expect(f.list).toHaveBeenCalledTimes(2))
    expect(screen.getByPlaceholderText('mailAccountsModal.passwordPlaceholder')).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['add', 'remove'])('a late %s cannot reload after A→B→A', async operation => {
    f.list.mockResolvedValue({ accounts: [account] })
    const held = deferred<{ id: string; messageCount: number }>()
    f[operation].mockReturnValue(held.promise)
    const view = await openModal(); await screen.findByText(account.email)
    if (operation === 'add') { enterAccount(); fireEvent.click(screen.getByText('mailAccountsModal.addButton')) }
    else fireEvent.click(screen.getByText('mailAccountsModal.remove'))
    await waitFor(() => expect(f[operation]).toHaveBeenCalledOnce())
    act(() => { users.setActiveSession(session('mail-modal-b')); users.setActiveSession(session('mail-modal-a')) })
    await act(async () => { held.resolve({ id: 'late', messageCount: 0 }); await held.promise })
    expect(f.list).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('mailAccountsModal.success')).not.toBeInTheDocument()
    await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1))
    expect(screen.getByPlaceholderText('mailAccountsModal.passwordPlaceholder')).toHaveValue('')
  })

  it.each(['add', 'remove'])('a late %s cannot mutate a reopened draft for the same owner', async operation => {
    f.list.mockResolvedValue({ accounts: [account] })
    const held = deferred<{ id: string; messageCount: number }>(); f[operation].mockReturnValue(held.promise)
    const view = await openModal(); await screen.findByText(account.email)
    if (operation === 'add') { enterAccount(); fireEvent.click(screen.getByText('mailAccountsModal.addButton')) }
    else fireEvent.click(screen.getByText('mailAccountsModal.remove'))
    await waitFor(() => expect(f[operation]).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByLabelText('common.close'))
    view.rerender(<MailAccountsModal open={false} onClose={view.close} />)
    view.rerender(<MailAccountsModal open onClose={view.close} />)
    await waitFor(() => expect(f.list).toHaveBeenCalledTimes(2))
    enterAccount('fresh-draft@example.test')
    await act(async () => { held.resolve({ id: 'late', messageCount: 0 }); await held.promise })
    expect(f.list).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText('mailAccountsModal.emailPlaceholder')).toHaveValue('fresh-draft@example.test')
    expect(screen.getByPlaceholderText('mailAccountsModal.passwordPlaceholder')).toHaveValue('synthetic-app-password')
    expect(screen.queryByText('mailAccountsModal.success')).not.toBeInTheDocument()
  })

  it('does not let an old initial inventory erase a newer reload in the same opening', async () => {
    const held = deferred<{ accounts: typeof account[] }>()
    const fresh = { ...account, id: 'fresh', email: 'fresh@example.test' }
    f.list.mockReturnValueOnce(held.promise).mockResolvedValueOnce({ accounts: [fresh] })
    await openModal(); enterAccount(); fireEvent.click(screen.getByText('mailAccountsModal.addButton'))
    await screen.findByText(fresh.email)
    await act(async () => { held.resolve({ accounts: [account] }); await held.promise })
    expect(screen.getByText(fresh.email)).toBeInTheDocument()
    expect(screen.queryByText(account.email)).not.toBeInTheDocument()
    expect(f.list).toHaveBeenCalledTimes(2)
  })

  it('displays an inventory failure, not a successful empty configuration', async () => {
    f.list.mockRejectedValue(new Error('synthetic inventory failure'))
    await openModal()
    expect(await screen.findByText('mailAccountsModal.errorGeneric')).toBeInTheDocument()
    expect(screen.queryByText('mailAccountsModal.success')).not.toBeInTheDocument()
  })

  it('never publishes an initial inventory after unmount', async () => {
    const held = deferred<{ accounts: typeof account[] }>(); f.list.mockReturnValue(held.promise)
    const view = await openModal(); view.unmount()
    await act(async () => { held.resolve({ accounts: [account] }); await held.promise })
    expect(f.list).toHaveBeenCalledTimes(1); expect(view.close).not.toHaveBeenCalled()
    expect(screen.queryByText(account.email)).not.toBeInTheDocument()
  })
})
