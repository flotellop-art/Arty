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
import { getAnthropicKey, setActiveKeys } from '../../services/activeApiKey'

beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear()
  users.setActiveSession({ userId: 'a', authMethod: 'apikey', displayName: 'A', createdAt: 1 })
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
describe('BYOK editing identity and commit', () => {
  it('closing a pending save cancels candidate publication as well as credential persistence', async () => {
    const payload = await c.encrypt('old content'), onClose = vi.fn(), release = hold()
    render(<ApiKeysModal open onClose={onClose} />); enterKey()
    await waitFor(() => expect(crypto.subtle.deriveKey).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await act(async () => { release() }); await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(localStorage.getItem('arty-a-api-keys')).toBe(JSON.stringify({ anthropic: 'old' }))
    expect(getAnthropicKey()).toBe('old'); expect(await c.decrypt(payload)).toBe('old content')
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('quota failure keeps old active credentials and usable crypto', async () => {
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
})
