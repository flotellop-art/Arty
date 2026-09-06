import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { ConnectionsSnapshot } from '../../services/connectionsStatus'
const f = vi.hoisted(() => ({ state: 'ready', platform: 'web', snapshot: null as ConnectionsSnapshot | null, current: true, actions: vi.fn(), refresh: vi.fn() }))
vi.mock('../../hooks/useConnectionsStatus', () => ({ useConnectionsStatus: () => ({ ...f, act: (action: () => void) => { if (f.current) { f.actions(); action() } } }) }))
import { ConnectionsScreen } from '../../screens/connections'
const props = () => ({ onBack: vi.fn(), onAccess: vi.fn(), onAgenda: vi.fn(), onApiKeys: vi.fn(), onMail: vi.fn(), onCloseConfiguration: vi.fn(), configurationOpen: false })
beforeEach(async () => {
  vi.clearAllMocks(); f.current = true; f.state = 'ready'; f.platform = 'web'
  f.snapshot = { platform: 'web', demo: false, session: 'email', google: 'not-configured', mail: 'not-supported', mailCount: 0,
    keys: [{ provider: 'anthropic', state: 'configured' }, { provider: 'openai', state: 'not-configured' }, { provider: 'gemini', state: 'unknown' }, { provider: 'mistral', state: 'not-configured' }] }
  await i18n.changeLanguage('fr'); vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['fr', 'en'])('renders honest capabilities in %s without any automatic action', async lang => {
  await i18n.changeLanguage(lang); const p = props(); render(<ConnectionsScreen {...p} />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(screen.getByText(i18n.t('connections.localOnly'))).toBeInTheDocument()
  expect(screen.getByText(i18n.t('connections.keys.setupNote'))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: i18n.t('connections.mail.action') })).not.toBeInTheDocument()
  expect(f.actions).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connections.keys.action') }))
  expect(p.onApiKeys).toHaveBeenCalledOnce()
})

it.each(['unknown', 'loading', 'unavailable', 'configured'] as const)('does not turn an Android %s inventory into a confirmed zero', state => {
  f.snapshot!.platform = 'android'; f.platform = 'android'; f.snapshot!.mail = state; f.snapshot!.mailCount = state === 'configured' ? 2 : 0
  render(<ConnectionsScreen {...props()} />)
  const card = screen.getByRole('article', { name: 'Mail IMAP' })
  expect(within(card).getByText(i18n.t(`connections.state.${state}`))).toBeInTheDocument()
  if (state === 'configured') expect(within(card).getByText('2 comptes enregistrés localement')).toBeInTheDocument()
  else expect(within(card).queryByText(/compte[s]? enregistré/)).not.toBeInTheDocument()
})

it('offers no unavailable platform integrations and does not allow demo configuration', () => {
  f.snapshot!.google = 'not-supported'; f.snapshot!.demo = true; f.snapshot!.session = 'demo'
  render(<ConnectionsScreen {...props()} />)
  expect(screen.queryByRole('button', { name: i18n.t('connections.google.action') })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: i18n.t('connections.keys.action') })).toBeDisabled()
})

it('renders unavailable without stale details and only relaunches a local read on request', () => {
  f.state = 'unavailable'; f.snapshot = null; render(<ConnectionsScreen {...props()} />)
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(f.refresh).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(i18n.t('connections.retry'))); expect(f.refresh).toHaveBeenCalledOnce()
})

it('explains the real preview restriction even when no private snapshot can be admitted', () => {
  f.state = 'unavailable'; f.snapshot = null
  render(<ConnectionsScreen {...props()} demo />)
  expect(screen.getByText(i18n.t('connections.demo'))).toBeInTheDocument()
  expect(screen.queryByText(i18n.t('connections.unavailable'))).not.toBeInTheDocument()
  expect(screen.queryByText(i18n.t('connections.retry'))).not.toBeInTheDocument()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('refocuses a new arrival on the same route without cleaning up the configuration owner', async () => {
  const p = props(), view = render(<ConnectionsScreen {...p} navigationKey="one" />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  screen.getByRole('button', { name: /Retour à l’accueil/ }).focus()
  view.rerender(<ConnectionsScreen {...p} navigationKey="two" />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(p.onCloseConfiguration).not.toHaveBeenCalled()
})

it('keeps route lifecycle stable across status/language changes and cancels deferred focus for an open configuration', async () => {
  const frames = new Map<number, FrameRequestCallback>(); let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } }
  const p = props(), view = render(<ConnectionsScreen {...p} />)
  act(flush)
  view.rerender(<ConnectionsScreen {...p} configurationOpen />)
  act(flush)
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
  expect(p.onCloseConfiguration).not.toHaveBeenCalled()
  await act(async () => { await i18n.changeLanguage('en') })
  expect(p.onCloseConfiguration).not.toHaveBeenCalled()
  expect(f.actions).not.toHaveBeenCalled()
  view.unmount(); expect(p.onCloseConfiguration).toHaveBeenCalledOnce(); expect(frames.size).toBe(0)
})

it('does not take focus from Settings or the mobile drawer opened between arrival frames', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  render(<ConnectionsScreen {...props()} />)
  act(() => { frames.shift()?.(0) })
  const dialog = document.createElement('div'), input = document.createElement('input')
  dialog.setAttribute('role', 'dialog'); dialog.append(input); document.body.append(dialog); input.focus()
  try {
    act(() => { for (const frame of frames.splice(0)) frame(0) })
    expect(input).toHaveFocus(); expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
  } finally { dialog.remove() }
})
