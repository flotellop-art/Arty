import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mock = vi.hoisted(() => ({ token: vi.fn(), share: vi.fn() }))
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mock.token }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => 'a', getActiveSessionEpoch: () => 1 }))
vi.mock('../../services/native/share', () => ({ shareContent: mock.share }))
vi.mock('../../services/toast', () => ({ toast: vi.fn() }))
import { ShareModal } from '../../components/chat/ShareModal'
const conv: Conversation = { id: 'c', title: 'Titre', hasProjectContext: true, createdAt: 1, updatedAt: 1, messages: [{ id: 'u', role: 'user', content: 'Texte approuvé', timestamp: 1 }] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); mock.share.mockResolvedValue(true) })
afterEach(() => vi.unstubAllGlobals())
describe('public share publication lifetime', () => {
  it.each(['button', 'escape'])('%s cancels during authentication, reopening does not revive that approval', async method => {
    const token = deferred<string>(); mock.token.mockReturnValue(token.promise)
    const close = vi.fn(), { rerender } = render(<ShareModal conversation={conv} open onClose={close} />)
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('share.publish'))
    await waitFor(() => expect(mock.token).toHaveBeenCalled())
    expect(screen.getByRole('checkbox')).toBeDisabled() // Annuler remains the explicit withdrawal control.
    if (method === 'button') fireEvent.click(screen.getByText('common.cancel'))
    else fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalled()
    rerender(<ShareModal conversation={conv} open={false} onClose={close} />)
    rerender(<ShareModal conversation={conv} open onClose={close} />)
    await act(async () => { token.resolve('test-token'); await token.promise })
    expect(fetch).not.toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
  it('closing after POST engagement warns about non-revocation and suppresses late native sharing', async () => {
    const response = deferred<Response>(); mock.token.mockResolvedValue('test-token'); vi.mocked(fetch).mockReturnValue(response.promise)
    const { rerender } = render(<ShareModal conversation={conv} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('share.publish'))
    await screen.findByText('share.publicationEngaged')
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('common.cancel')); rerender(<ShareModal conversation={conv} open={false} onClose={vi.fn()} />)
    await act(async () => { response.resolve(new Response(JSON.stringify({ id: 'public' }), { status: 200 })); await response.promise })
    expect(mock.share).not.toHaveBeenCalled()
  })
})
