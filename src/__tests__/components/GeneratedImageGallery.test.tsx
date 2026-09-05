import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
const mock = vi.hoisted(() => ({ ready: vi.fn(() => true), cryptoCurrent: vi.fn(() => true), read: vi.fn(), getFile: vi.fn(), deliver: vi.fn() }))
vi.mock('../../services/crypto', () => ({ isCryptoReady: mock.ready, captureCryptoGuard: () => mock.cryptoCurrent }))
vi.mock('../../services/generatedImageFiles', async original => ({ ...await original<typeof import('../../services/generatedImageFiles')>(), readGeneratedImage: mock.read }))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: mock.deliver }))
vi.mock('../../services/secureFileStorage', () => ({ getFile: mock.getFile, deleteOwnedFiles: vi.fn() }))
import { GeneratedImageGallery } from '../../components/chat/GeneratedImageGallery'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'
import { setActiveSession, invalidateActiveSessionWork } from '../../services/userSession'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import { MessageList } from '../../components/chat/MessageList'
import { useStreaming } from '../../hooks/useStreaming'
import * as storage from '../../services/storage'
import i18n from '../../i18n'

const id = '123e4567-e89b-12d3-a456-426614174000'
let observers: ((entries: { isIntersecting: boolean }[]) => void)[]
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mock.ready.mockReturnValue(true); mock.cryptoCurrent.mockReturnValue(true)
  setActiveSession({ userId: 'gallery-a', authMethod: 'demo', displayName: 'Synthetic', createdAt: 1 })
  observers = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observers.push(callback) }
    observe() {} disconnect() {}
  })
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:synthetic-image'), revokeObjectURL: vi.fn(),
  }))
  mock.read.mockImplementation(async (_id: string, signal: AbortSignal, view: () => void) => {
    const assertCurrent = () => { view(); if (signal.aborted) throw new DOMException('cancelled', 'AbortError') }
    assertCurrent()
    return { blob: new Blob(['synthetic'], { type: 'image/jpeg' }), filename: 'arty-image.jpg', assertCurrent, validate: async () => assertCurrent() }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const enter = () => act(() => observers[0]!([{ isIntersecting: true }]))
describe('private gallery DOM lifecycle (not native visual acceptance)', () => {
  it('does not read offscreen, downloads stored MIME file and revokes/reloads outside viewport', async () => {
    const { unmount } = render(<GeneratedImageGallery images={[id]} />)
    expect(mock.read).not.toHaveBeenCalled()
    enter(); await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('image.gallerySave') }))
    await waitFor(() => expect(mock.deliver).toHaveBeenCalledOnce())
    expect(mock.deliver.mock.calls[0]![0].type).toBe('image/jpeg')
    expect(mock.deliver.mock.calls[0]![1]).toBe('arty-image.jpg')
    act(() => observers[0]!([{ isIntersecting: false }]))
    expect(screen.queryByRole('img')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-image')
    enter(); await screen.findByRole('img')
    expect(mock.read).toHaveBeenCalledTimes(2)
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
  it.each(['epoch', 'crypto', 'fence', 'known', 'clear'] as const)('revokes loaded URLs and never reacquires after %s invalidation', async change => {
    render(<GeneratedImageGallery images={[id]} />); enter(); await screen.findByRole('img')
    act(() => {
      if (change === 'epoch') invalidateActiveSessionWork()
      else if (change === 'crypto') { mock.cryptoCurrent.mockReturnValue(false); invalidateLocalDataViews() }
      else window.dispatchEvent(new StorageEvent('storage', { key: change === 'fence' ? 'arty-project-erasure-fence' : change === 'known' ? 'arty-known-sessions' : null }))
    })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('image.gallerySave') })).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    enter(); expect(mock.read).toHaveBeenCalledOnce()
  })
  it('waits for initial crypto readiness before mounting a crash-recovered image', async () => {
    mock.ready.mockReturnValue(false)
    render(<GeneratedImageGallery images={[id]} />)
    expect(observers).toHaveLength(0); expect(mock.read).not.toHaveBeenCalled()
    act(() => { mock.ready.mockReturnValue(true); window.dispatchEvent(new Event('conversations-storage-ready')) })
    enter(); await screen.findByRole('img')
    expect(mock.read).toHaveBeenCalledOnce()
  })
  it('does not acquire initial crypto under a different session epoch', () => {
    mock.ready.mockReturnValue(false)
    render(<GeneratedImageGallery images={[id]} />)
    act(() => { invalidateActiveSessionWork(); mock.ready.mockReturnValue(true); window.dispatchEvent(new Event('conversations-storage-ready')) })
    expect(observers).toHaveLength(0); expect(mock.read).not.toHaveBeenCalled()
  })
  it('has an explicit load action without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<GeneratedImageGallery images={[id]} />)
    expect(mock.read).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('image.galleryLoad') }))
    await screen.findByRole('img')
  })
  it('shows an unavailable state for failed decoding without regenerating', async () => {
    render(<GeneratedImageGallery images={[id]} />); enter()
    fireEvent.error(await screen.findByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('image.galleryUnavailable'))
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    expect(mock.read).toHaveBeenCalledOnce()
  })
  it('never reads private IDs from Markdown, raw HTML, data or blob URIs', () => {
    render(<MarkdownRenderer content={`![a](arty-img://${id})\n<img src="arty-img://${id}">\n![b](data:image/png;base64,aaaa)\n![c](blob:secret)`} />)
    expect(mock.read).not.toHaveBeenCalled()
    expect(mock.getFile).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('does not rearm a live gallery through its persisted placeholder after invalidation', async () => {
    storage.resetConversationMemCache(); localStorage.setItem('arty-conv-encryption-disabled', '1')
    storage.saveConversation({ id: 'c1', title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 })
    let streaming!: ReturnType<typeof useStreaming>
    function Harness() {
      const [conversations, refresh] = useState(() => storage.getConversations())
      streaming = useStreaming({ refreshConversations: () => refresh([...storage.getConversations()]) })
      return <MessageList messages={conversations[0]!.messages} isStreaming={streaming.isStreaming} streamingContent={streaming.streamingContent} streamingImages={streaming.streamingImages} />
    }
    render(<Harness />)
    act(() => {
      streaming.setActiveStream('c1'); streaming.startStream('c1')
      streaming.adoptGeneratedImage('c1', streaming.getInvocationId('c1')!, id, () => {})
    })
    enter(); await screen.findByRole('img')
    // Simulate a crypto generation change that finishes with the same key:
    // a NEW view could read the file, but no implicit remount is authorized.
    act(() => invalidateLocalDataViews())
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('image.galleryUnavailable'))
    expect(observers).toHaveLength(1)
    expect(mock.read).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('rejects malformed and sparse receipt arrays', () => {
    render(<GeneratedImageGallery images={new Array<string>(1)} />)
    expect(screen.queryByRole('region')).toBeNull(); expect(mock.read).not.toHaveBeenCalled()
  })
})
