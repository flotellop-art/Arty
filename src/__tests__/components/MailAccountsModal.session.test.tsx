import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn(), t: (key: string) => key, unstable: false, locale: '' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: f.unstable ? (key: string) => `${f.locale}${key}` : f.t }) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ listAccounts: f.list, addAccount: f.add, removeAccount: f.remove }),
}))
import { MailAccountsModal } from '../../components/settings/MailAccountsModal'
import * as users from '../../services/userSession'
import * as cryptoService from '../../services/crypto'
import * as projects from '../../services/projects/store'
import { getMailInventoryStatus, refreshMailAccounts, resetMailAccountsCache } from '../../services/mailAccounts'

const account = { id: 'synthetic-old', provider: 'imap', email: 'old@example.test', label: 'Synthetic', host: 'example.test' }
const session = (userId: string) => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  users.setActiveSession(session('mail-modal-a')); await cryptoService.initCrypto('synthetic-local-key')
  resetMailAccountsCache(); f.list.mockReset().mockResolvedValue({ accounts: [] })
  f.unstable = false; f.locale = ''
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
  it.each(['success', 'durable-fence-failure'])('publishes no inventory before its own durable admission (%s)', async outcome => {
    // A readonly fence fixture; no cached writer connection across fresh IDB factories.
    const fixture = await openDB('arty-projects', 1, { upgrade(db) { db.createObjectStore('meta') } }); fixture.close()
    const held = deferred<void>(), capture = projects.captureLocalReadScope
    vi.spyOn(projects, 'captureLocalReadScope').mockImplementation(signal => {
      const scope = capture(signal)
      return { ...scope, async validateReadOnly() { await held.promise; await scope.validateReadOnly() } }
    })
    render(<MailAccountsModal open onClose={() => {}} />)
    f.list.mockResolvedValue({ accounts: [account] })
    await act(async () => { await refreshMailAccounts() })
    expect(getMailInventoryStatus().status).toBe('ready')
    expect(screen.queryByText(account.email)).not.toBeInTheDocument()
    if (outcome === 'durable-fence-failure') {
      const db = await openDB('arty-projects'); await db.put('meta', 'different-durable-fence', 'erasure-fence'); db.close()
    }
    await act(async () => { held.resolve(); await held.promise })
    if (outcome === 'success') await screen.findByText(account.email)
    else {
      await screen.findByText('mailAccountsModal.errorGeneric')
      expect(screen.queryByText(account.email)).not.toBeInTheDocument()
      expect(f.list).toHaveBeenCalledTimes(1)
    }
  })

  it('retires the discarded StrictMode opening before its native inventory', async () => {
    const view = render(<StrictMode><MailAccountsModal open onClose={() => {}} /></StrictMode>)
    await waitFor(() => expect(f.list).toHaveBeenCalledTimes(1))
    enterAccount(); expect(screen.getByPlaceholderText('mailAccountsModal.emailPlaceholder')).toHaveValue('new@example.test')
    expect(f.list).toHaveBeenCalledTimes(1); view.unmount()
  })

  it.each(['success', 'error'])('preserves a pending draft with unstable translation and translates late %s in the current language', async outcome => {
    f.unstable = true
    const held = deferred<{ id: string; messageCount: number }>(); f.add.mockReturnValue(held.promise)
    const view = await openModal(); enterAccount(); fireEvent.click(screen.getByText('mailAccountsModal.addButton'))
    await waitFor(() => expect(f.add).toHaveBeenCalledTimes(1))
    f.locale = 'EN:'
    view.rerender(<MailAccountsModal open onClose={() => view.close()} />)
    expect(screen.getByPlaceholderText('EN:mailAccountsModal.emailPlaceholder')).toHaveValue('new@example.test')
    expect(screen.getByPlaceholderText('EN:mailAccountsModal.passwordPlaceholder')).toHaveValue('synthetic-app-password')
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('EN:mailAccountsModal.testing')).toBeDisabled()
    expect(f.list).toHaveBeenCalledTimes(1)
    await act(async () => {
      if (outcome === 'success') held.resolve({ id: 'new', messageCount: 0 })
      else held.reject(new Error('connect_failed'))
      await held.promise.catch(() => {})
    })
    await screen.findByText(`EN:mailAccountsModal.${outcome === 'success' ? 'success' : 'errorConnect'}`)
    expect(f.list).toHaveBeenCalledTimes(outcome === 'success' ? 2 : 1)
    expect(f.add).toHaveBeenCalledTimes(1)
  })

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
    expect(getMailInventoryStatus().status).toBe('unknown')
    expect(screen.queryByText(account.email)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('adopts the current cache when an external inventory supersedes its pending initial read', async () => {
    const held = deferred<{ accounts: typeof account[] }>()
    const fresh = { ...account, id: 'external', email: 'external@example.test' }
    f.list.mockReturnValueOnce(held.promise).mockResolvedValueOnce({ accounts: [fresh] })
    await openModal(); enterAccount()
    await act(async () => { await refreshMailAccounts() })
    expect(screen.getByText(fresh.email)).toBeInTheDocument()
    await act(async () => { held.resolve({ accounts: [account] }); await held.promise })
    expect(screen.getByText(fresh.email)).toBeInTheDocument()
    expect(screen.queryByText(account.email)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('mailAccountsModal.emailPlaceholder')).toHaveValue('new@example.test')
    expect(screen.getByRole('checkbox')).toBeChecked(); expect(f.list).toHaveBeenCalledTimes(2)
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
