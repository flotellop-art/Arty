import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const fixture = vi.hoisted(() => ({ owner: 'a', epoch: 1, records: new Map<string, Conversation>(), setModel: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => fixture.owner, getActiveSessionEpoch: () => fixture.epoch }))
vi.mock('../../services/storage', () => ({ getConversation: (id: string) => fixture.records.get(id) ?? null }))
vi.mock('../../services/modelSelector', () => ({ setSelectedModel: fixture.setModel }))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => ({ lockedFamilies: [] }) }))
vi.mock('../../services/checkout', () => ({ canPurchase: false }))
import i18n from '../../i18n'
import { CapReachedModal } from '../../components/chat/CapReachedModal'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
beforeEach(async () => {
  vi.clearAllMocks(); fixture.owner = 'a'; fixture.epoch = 1; fixture.records.clear()
  await i18n.changeLanguage('fr')
  fixture.records.set('chat', { id: 'chat', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
function open(id: string | undefined = 'chat') {
  render(<MemoryRouter><CapReachedModal /></MemoryRouter>)
  act(() => window.dispatchEvent(new CustomEvent('arty-cap-reached', { detail: { conversationId: id, bucket: 'claude-sonnet' } })))
}
describe('premium cap — no false Mistral switch from documentary/missing/stale target', () => {
  it.each(['project', 'detached', 'office', 'missing'] as const)('does not offer a switch for %s', kind => {
    const chat = fixture.records.get('chat')!
    if (kind === 'project') chat.projectId = 'project'
    if (kind === 'detached') chat.hasProjectContext = true
    if (kind === 'office') chat.messages.push({ id: 'u', role: 'user', content: 'Document', timestamp: 1, files: [{ id: 'file', name: 'source.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] })
    if (kind === 'missing') fixture.records.delete('chat')
    open(); expect(screen.queryByRole('button', { name: /Mistral/ })).not.toBeInTheDocument(); expect(fixture.setModel).not.toHaveBeenCalled()
  })
  it.each(['owner', 'epoch', 'deleted', 'became-documentary'] as const)('rechecks %s synchronously at click before mutating the selector', change => {
    open(); const button = screen.getByRole('button', { name: /Mistral/ })
    if (change === 'owner') fixture.owner = 'b'
    if (change === 'epoch') fixture.epoch++
    if (change === 'deleted') fixture.records.delete('chat')
    if (change === 'became-documentary') fixture.records.get('chat')!.hasProjectContext = true
    fireEvent.click(button); expect(fixture.setModel).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('closes on invalidation, and still permits the unchanged ordinary chat choice', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: /Mistral/ })); expect(fixture.setModel).toHaveBeenCalledOnce()
    act(() => window.dispatchEvent(new CustomEvent('arty-cap-reached', { detail: { conversationId: 'chat' } })))
    act(() => invalidateLocalDataViews()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
