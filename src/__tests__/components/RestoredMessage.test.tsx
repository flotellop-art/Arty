import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'
import { MessageList } from '../../components/chat/MessageList'
import { FactCheckBadge } from '../../components/chat/FactCheckBadge'
import type { FactCheckResult, Message } from '../../types'
import i18n from '../../i18n'

const historicalText = [
  '<button data-action="create_event" data-title="Ancien RDV">Ancienne action</button>',
  '<div data-action="view_trail" data-trail-id="legacy" style="width:75%;background-image:url(https://tracker.example/pixel)">Ancienne carte</div>',
  '<span style="width:25%">Ancienne barre</span>',
  '[Rapport](/report/legacy) [Carte](/trail/legacy) [Site](https://example.com) [Mail](mailto:test@example.com) [Téléphone](tel:123)',
  '![image distante](https://tracker.example/pixel) ![image privée](arty-img://123e4567-e89b-12d3-a456-426614174000)',
  '<script>danger()</script><iframe src="https://tracker.example"></iframe>',
  '```js\nconst original = "été"\n```',
].join('\n\n')
const pending = (legacy = false): FactCheckResult => ({
  ...(legacy ? {} : { status: 'pending' as const }),
  modelLabel: 'Vérification en cours…', checkedAt: Date.now() + 86_400_000,
  overallConfidence: 'high', claims: [], originalContent: 'Texte exact\r\n', appliedCorrections: 0,
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('restored history rendering policy (synthetic, no restore publication)', () => {
  it('keeps historical text/code but strips action attributes, styles, links and image loaders', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const { container } = render(<MarkdownRenderer content={historicalText} historical />)
    expect(container.querySelector('a, img, script, iframe, [data-action], [data-trail-id], [style]')).toBeNull()
    for (const label of ['Ancienne action', 'Ancienne carte', 'Ancienne barre', 'Rapport', 'Carte', 'Site', 'Mail', 'Téléphone']) {
      expect(screen.getByText(label)).toBeVisible()
    }
    // Only the app-owned code-copy control survives, not archive buttons.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: i18n.t('chat.bubble.copyCode') })).toBeVisible()
    expect(container.querySelector('pre code')?.textContent).toContain('const original = "été"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('shows future-dated historical pending without active animation or data rewrite (legacy=%s)', legacy => {
    const factCheck = pending(legacy), original = structuredClone(factCheck)
    const { container, rerender } = render(<FactCheckBadge result={factCheck} historical />)
    expect(screen.getByRole('note').textContent).toBe(i18n.t('workspaceArchive.historicalPending'))
    expect(container.querySelector('[class*="animate-"]')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(factCheck).toEqual(original)
    // Policy can change on the same component without a hook-order issue.
    rerender(<FactCheckBadge result={factCheck} />)
    expect(screen.getByRole('button').textContent).toContain(i18n.t('chat.factCheck.pending'))
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull()
  })

  it('propagates the persisted marker through MessageList, but keeps explicit native controls and new answers usable', async () => {
    vi.useFakeTimers()
    const clipboard = vi.fn(async () => {})
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText: clipboard } }))
    const onAction = vi.fn(), onBranch = vi.fn(), onExport = vi.fn(), onReport = vi.fn(), onRetry = vi.fn(), onTogglePin = vi.fn()
    // This is a normal synthetic message record, never an unpublished plan.
    const messages: Message[] = [
      { id: 'u', role: 'user', content: 'Question', timestamp: 1, restoredArchive: true },
      { id: 'a', role: 'assistant', content: historicalText, timestamp: 2, restoredArchive: true, factCheck: pending() },
    ]
    const { container, rerender } = render(<MessageList messages={messages} isStreaming={false} streamingContent=""
      onAction={onAction} onBranch={onBranch} onExport={onExport} onReport={onReport} onRetry={onRetry} onTogglePin={onTogglePin} />)
    const row = container.querySelector('[data-msg-id="a"]') as HTMLElement, bubble = within(row)
    expect(bubble.getByText(i18n.t('workspaceArchive.historicalMessage'))).toBeVisible()
    expect(bubble.getByText(i18n.t('workspaceArchive.historicalPending'))).toBeVisible()
    fireEvent.click(bubble.getByText('Ancienne action'))
    fireEvent.click(bubble.getByText('Ancienne carte'))
    expect(onAction).not.toHaveBeenCalled()
    // Defense in depth: even if a descendant acquires action attributes, the
    // delegated handler independently refuses a restored message.
    const injected = bubble.getByText('Ancienne carte')
    injected.setAttribute('data-action', 'create_event')
    fireEvent.click(injected)
    expect(onAction).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.bubble.copy') })) })
    expect(clipboard).toHaveBeenLastCalledWith(historicalText)
    await act(async () => { fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.bubble.copyCode') })) })
    expect(clipboard).toHaveBeenLastCalledWith('const original = "été"')
    fireEvent.click(bubble.getByRole('button', { name: 'Exporter cette réponse en Word ou Excel' }))
    fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.bubble.report') }))
    fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.bubble.regenerate') }))
    fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.messageList.branch') }))
    fireEvent.click(bubble.getByRole('button', { name: i18n.t('chat.bubble.pin') }))
    expect(onExport).toHaveBeenCalledExactlyOnceWith('a')
    expect(onReport).toHaveBeenCalledExactlyOnceWith('a')
    expect(onRetry).toHaveBeenCalledExactlyOnceWith('a')
    expect(onBranch).toHaveBeenCalledExactlyOnceWith(1)
    expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('a')
    // jsdom has no layout scrolling; keep the real browser interaction intact.
    Object.defineProperty(container.querySelector('[data-msg-id="u"]'), 'scrollIntoView', { value: vi.fn() })
    // A fresh answer in the same conversation must not inherit historical UI.
    rerender(<MessageList messages={[...messages, { id: 'fresh', role: 'assistant', timestamp: 3,
      content: '<button data-action="create_event" data-title="Nouveau">Nouvelle action</button>\n\n[Source](https://example.com)',
    }]} isStreaming={false} streamingContent="" onAction={onAction} />)
    const fresh = within(container.querySelector('[data-msg-id="fresh"]') as HTMLElement)
    fireEvent.click(fresh.getByRole('button', { name: 'Nouvelle action' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('create_event', { title: 'Nouveau' })
    expect(fresh.getByRole('link').getAttribute('href')).toBe('https://example.com')
    expect(fresh.queryByText(i18n.t('workspaceArchive.historicalMessage'))).toBeNull()
    act(() => vi.runOnlyPendingTimers())
  })
})
