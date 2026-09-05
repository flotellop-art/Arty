import { StrictMode, useEffect, lazy } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentWorkspaceGate } from '../../components/workspace/DocumentWorkspaceGate'
import { createDocumentWorkspaceLock } from '../../services/workspaceWriter/documentLock'
import { deferred, sharedWorkspaceLocks } from '../helpers/workspaceLocks'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

describe('workspace gate is before any private hooks/import/seed', () => {
  it('StrictMode setup-cleanup-setup reserves once and never releases on unmount', async () => {
    const locks = sharedWorkspaceLocks(), controller = createDocumentWorkspaceLock(() => locks.source)
    const loaded = vi.fn(async () => ({ default: () => <div>private-ready</div> })), Content = lazy(loaded)
    const view = render(<StrictMode><DocumentWorkspaceGate controller={controller} Content={Content} /></StrictMode>)
    await screen.findByText('private-ready'); expect(loaded).toHaveBeenCalledOnce()
    view.unmount(); expect(locks.held.size).toBe(1)
    render(<StrictMode><DocumentWorkspaceGate controller={controller} Content={Content} /></StrictMode>)
    await screen.findByText('private-ready'); expect(locks.requested).toHaveLength(1)
  })

  it('busy OAuth return never imports Content or consumes the URL/state/verifier; retry reads fresh', async () => {
    const locks = sharedWorkspaceLocks(), a = createDocumentWorkspaceLock(() => locks.source), b = createDocumentWorkspaceLock(() => locks.source)
    await a.acquire()
    window.history.replaceState({}, '', '/auth/callback?code=synthetic-code&state=synthetic-state')
    sessionStorage.setItem('synthetic-oauth-state', 'keep'); sessionStorage.setItem('synthetic-verifier', 'keep')
    localStorage.setItem('synthetic-history', 'before')
    const loaded = vi.fn(async () => ({ default: () => <div>{localStorage.getItem('synthetic-history')}</div> })), Content = lazy(loaded)
    render(<DocumentWorkspaceGate controller={b} Content={Content} />)
    await screen.findByText('workspaceWindow.busyTitle')
    fireEvent.click(screen.getByText('workspaceWindow.retry')); await waitFor(() => expect(locks.requested).toHaveLength(3))
    await screen.findByText('workspaceWindow.busyTitle')
    expect(loaded).not.toHaveBeenCalled(); expect(window.location.search).toBe('?code=synthetic-code&state=synthetic-state')
    expect(sessionStorage.getItem('synthetic-oauth-state')).toBe('keep'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
    localStorage.setItem('synthetic-history', 'latest-durable')
    locks.held.clear() // browser destruction simulation only
    fireEvent.click(screen.getByText('workspaceWindow.retry'))
    await screen.findByText('latest-durable'); expect(loaded).toHaveBeenCalledOnce()
    window.history.replaceState({}, '', '/'); sessionStorage.clear(); localStorage.clear()
  })

  it('without Web Locks shows a distinct explanation and never mounts private effects', async () => {
    const opened = vi.fn(), controller = createDocumentWorkspaceLock(() => undefined)
    function Content() { useEffect(opened, []); return <div>private-ready</div> }
    render(<DocumentWorkspaceGate controller={controller} Content={Content} />)
    await screen.findByText('workspaceWindow.unsupportedTitle')
    expect(opened).not.toHaveBeenCalled(); expect(screen.queryByText('workspaceWindow.retry')).toBeNull()
    expect(screen.getByText('workspaceWindow.discover')).toHaveAttribute('href', '/discover')
  })

  it('keeps its grant after a failed lazy import; private failure does not allow another writer', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const locks = sharedWorkspaceLocks(), controller = createDocumentWorkspaceLock(() => locks.source)
    const Content = lazy(async () => { throw new Error('synthetic chunk failure') })
    render(<DocumentWorkspaceGate controller={controller} Content={Content} />)
    await screen.findByText('workspaceWindow.loadFailedTitle')
    expect(screen.getByRole('button', { name: 'workspaceWindow.reload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
    expect(controller.getSnapshot()).toBe('held')
    expect(await createDocumentWorkspaceLock(() => locks.source).acquire()).toBe('busy')
    errors.mockRestore()
  })

  it('exceptional lock loss removes private effects and allows only cold reload, not re-acquisition', async () => {
    const request = deferred(), cleanupEffect = vi.fn()
    const controller = createDocumentWorkspaceLock(() => ({ request(_name, _options, callback) { void callback({}); return request.promise } }))
    function Content() { useEffect(() => cleanupEffect, []); return <div>private-ready</div> }
    render(<DocumentWorkspaceGate controller={controller} Content={Content} />)
    await screen.findByText('private-ready')
    await act(async () => { request.reject(new Error('lost')) })
    await screen.findByText('workspaceWindow.lostTitle'); expect(cleanupEffect).toHaveBeenCalledOnce()
    expect(screen.queryByText('private-ready')).toBeNull(); expect(screen.queryByText('workspaceWindow.retry')).toBeNull()
  })
})
