import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../components/settings/ApiKeySetup', () => ({ ApiKeySetup: ({ onSave }: { onSave: (keys: { anthropic: string }) => Promise<void> }) => {
  const [value, setValue] = useState(''), [status, setStatus] = useState('')
  return <div><input aria-label="test-key" value={value} onChange={e => setValue(e.target.value)} />
    <button onClick={() => { void onSave({ anthropic: value }).then(() => setStatus('saved'), () => setStatus('failed')) }}>Save</button>
    <output>{status}</output></div>
} }))
import { ApiKeysModal } from '../../components/settings/ApiKeysModal'
import * as users from '../../services/userSession'
import * as c from '../../services/crypto'
import * as google from '../../services/googleAuth'
import * as notifications from '../../services/toast'
import { getAnthropicKey, setActiveKeys } from '../../services/activeApiKey'

beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear()
  users.setActiveSession({ userId: 'a', authMethod: 'apikey', displayName: 'A', createdAt: 1 })
  google.resetGoogleMemCache()
  await c.initCrypto('old'); setActiveKeys('old')
  localStorage.setItem('arty-a-api-keys', JSON.stringify({ anthropic: 'old' }))
})
afterEach(() => vi.restoreAllMocks())
function hold() {
  let release!: () => void; const gate = new Promise<void>(r => { release = r })
  const actual = crypto.subtle.deriveKey.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce(async (...args) => { const key = await actual(...args); await gate; return key })
  return release
}
function enterKey() { fireEvent.change(screen.getByLabelText('test-key'), { target: { value: 'new' } }); fireEvent.click(screen.getByText('Save')) }
async function installGoogle() {
  await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' })
  await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'synthetic@example.invalid' })
  await google.bootstrapGoogleStorage()
  return google.captureGoogleGrant()!
}
describe('BYOK editing identity and commit', () => {
  it.each(['old', 'new'])('preserves a Google grant through a real key save and reload (key=%s)', async key => {
    const user = { email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' }
    await google.storeUser(user)
    await google.storeMailboxFreeGrant({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: user.email })
    await google.bootstrapGoogleStorage()
    const lease = google.captureGoogleGrant()!, onClose = vi.fn()
    render(<ApiKeysModal open onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('test-key'), { target: { value: key } }); fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(lease.isCurrent()).toBe(false)
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
    expect(JSON.parse(await c.decrypt(localStorage.getItem('arty-a-google-user-enc')!))).toEqual(user)
    expect(JSON.parse(await c.decrypt(localStorage.getItem('arty-a-google-tokens-enc')!))).toMatchObject({ access_token: 'synthetic-access' })
    google.resetGoogleMemCache(); await c.initCrypto(key); await google.bootstrapGoogleStorage()
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
    expect(lease.isCurrent()).toBe(false)
  })
  it('closing a pending save cancels candidate publication as well as credential persistence', async () => {
    const lease = await installGoogle()
    const payload = await c.encrypt('old content'), onClose = vi.fn(), release = hold()
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(crypto.subtle.deriveKey).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await act(async () => { release() }); await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(localStorage.getItem('arty-a-api-keys')).toBe(JSON.stringify({ anthropic: 'old' }))
    expect(getAnthropicKey()).toBe('old'); expect(await c.decrypt(payload)).toBe('old content')
    expect(onClose).toHaveBeenCalledOnce()
    expect(lease.isCurrent()).toBe(false)
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
  })
  it('quota failure keeps old active credentials and usable crypto', async () => {
    const lease = await installGoogle()
    const payload = await c.encrypt('old content'), onClose = vi.fn()
    const actual = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'arty-a-api-keys') throw new DOMException('quota', 'QuotaExceededError')
      actual.call(this, key, value)
    })
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(getAnthropicKey()).toBe('old'); expect(await c.decrypt(payload)).toBe('old content')
    expect(onClose).not.toHaveBeenCalled()
    expect(lease.isCurrent()).toBe(false)
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
  })
  it('an open draft is closed, not rebound, if the owner changes without toggling open', () => {
    const onClose = vi.fn(), view = render(<ApiKeysModal open onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('test-key'), { target: { value: 'SECRET A' } })
    users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 1 })
    view.rerender(<ApiKeysModal open onClose={onClose} />)
    expect(screen.queryByLabelText('test-key')).not.toBeInTheDocument()
    expect(localStorage.getItem('arty-b-api-keys')).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })
  it('a successful save commits credentials and the candidate together', async () => {
    const onClose = vi.fn(); render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(localStorage.getItem('arty-a-api-keys')).toBe(JSON.stringify({ anthropic: 'new' }))
    expect(getAnthropicKey()).toBe('new')
    const payload = await c.encrypt('new content'); expect(await c.decrypt(payload)).toBe('new content')
  })
  it('waiting for a cold initialization cannot supersede it when the modal is closed', async () => {
    users.setActiveSession({ userId: 'cold', authMethod: 'apikey', displayName: 'Cold', createdAt: 1 })
    localStorage.setItem('arty-cold-api-keys', JSON.stringify({ anthropic: 'stored' }))
    const release = hold(), cold = c.initCrypto('stored'), onClose = vi.fn()
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await act(async () => { release(); await cold })
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(c.isCryptoReady()).toBe(true)
    expect(localStorage.getItem('arty-cold-api-keys')).toBe(JSON.stringify({ anthropic: 'stored' }))
    expect(await c.verifyCrypto('stored')).toBe(true)
  })

  it.each(['google-tokens-enc', 'google-user-enc'])('reports keys saved but Google unavailable when %s cannot be committed', async suffix => {
    await installGoogle()
    const actual = Storage.prototype.setItem, onClose = vi.fn(), toast = vi.spyOn(notifications, 'toast').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === `arty-a-${suffix}`) throw new DOMException('quota', 'QuotaExceededError')
      actual.call(this, key, value)
    })
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(getAnthropicKey()).toBe('new')
    expect(localStorage.getItem('arty-a-api-keys')).toBe(JSON.stringify({ anthropic: 'new' }))
    expect(google.getStoredTokens()).toBeNull()
    expect(toast).toHaveBeenCalledWith('apiKeysModal.savedGoogleUnavailable', 'info')
    expect(screen.getByText('saved')).toBeInTheDocument()
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
  })

  it('finishes the committed Google transfer after the dialog is closed during encryption', async () => {
    const lease = await installGoogle(), actual = c.encrypt, onClose = vi.fn()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(c, 'encrypt').mockImplementationOnce(async value => { const encoded = await actual(value); await gate; return encoded })
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(c.encrypt).toHaveBeenCalledTimes(2))
    expect(getAnthropicKey()).toBe('new')
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await act(async () => { release() })
    await waitFor(() => expect(google.captureGoogleGrant()?.isCurrent()).toBe(true))
    expect(lease.isCurrent()).toBe(false)
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('refuses a save before touching API keys while Google bootstrap is still incomplete', async () => {
    await installGoogle()
    const raw = JSON.stringify(google.getStoredTokens()), onClose = vi.fn()
    let release!: (value: string) => void
    vi.spyOn(c, 'decrypt').mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const bootstrap = google.bootstrapGoogleStorage(), before = localStorage.getItem('arty-a-api-keys')
    const toast = vi.spyOn(notifications, 'toast').mockImplementation(() => {})
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(localStorage.getItem('arty-a-api-keys')).toBe(before)
    expect(toast).toHaveBeenCalledWith('apiKeysModal.googleLoadingBeforeSave', 'info')
    await act(async () => { release(raw); await bootstrap })
    expect(await google.getValidAccessToken()).toBe('synthetic-access')
  })

  it('does not report a stale Google failure after a new connection wins during transfer', async () => {
    await installGoogle()
    const actual = c.encrypt, onClose = vi.fn(), toast = vi.spyOn(notifications, 'toast').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(c, 'encrypt').mockImplementationOnce(async value => { const encoded = await actual(value); await gate; return encoded })
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(c.encrypt).toHaveBeenCalledTimes(2))
    await act(async () => {
      await google.storeUser({ email: 'fresh@example.invalid', name: 'Fresh', picture: '' })
      await google.storeMailboxFreeGrant({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'fresh@example.invalid' })
    })
    const currentRaw = localStorage.getItem('arty-a-google-tokens-enc')
    await act(async () => { release() })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(google.getStoredTokens()?.access_token).toBe('fresh-access')
    expect(localStorage.getItem('arty-a-google-tokens-enc')).toBe(currentRaw)
    // Optional file storage is unavailable in this fixture; its separate
    // loading notice is not a failure of the newer Google connection.
    expect(toast).not.toHaveBeenCalledWith('apiKeysModal.savedGoogleUnavailable', 'info')
  })
})
