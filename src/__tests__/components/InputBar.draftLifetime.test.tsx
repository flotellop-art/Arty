import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'
import { deferred, sharedWorkspaceLocks } from '../helpers/workspaceLocks'

vi.unmock('../../services/workspaceWriter/runtime')
// Exercise both real layouts, not production activation (which remains OFF).
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
vi.mock('react-i18next', async original => ({ ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../hooks/useSpeechRecognition', () => ({ useSpeechRecognition: () => ({
  isListening: false, interimTranscript: '', error: null, isSupported: false,
  startListening: vi.fn(), stopListening: vi.fn(),
}) }))
vi.mock('../../services/native/platform', () => ({ isNative: false }))
vi.mock('../../services/native/camera', () => ({ takePhoto: vi.fn(), scanDocument: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => null) }))
vi.mock('../../services/googleApiHelper', () => ({ callGoogleApi: vi.fn() }))
vi.mock('../../services/promptEnhancer', () => ({ enhancePrompt: vi.fn(), canEnhancePrompt: () => false }))
vi.mock('../../services/promptEnhancerSettings', () => ({ isPromptEnhancementEnabled: () => false }))
vi.mock('../../services/aiRouter', () => ({ hasUrl: () => false }))
vi.mock('../../services/activeApiKey', () => ({ hasOpenAIKey: () => false }))
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn(async () => {}) }))
vi.mock('../../components/chat/ReflectionPill', () => ({ ReflectionPill: () => null }))

let runtime: typeof import('../../services/workspaceWriter/runtime')
let users: typeof import('../../services/userSession')
let crypt: typeof import('../../services/crypto')
let drafts: typeof import('../../services/composerDrafts')
let erasure: typeof import('../../services/projects/localErasureGuard')
let InputBar: typeof import('../../components/layout/InputBar')['InputBar']
const account = (userId: string) => ({ userId, displayName: userId, authMethod: 'apikey' as const, createdAt: 1 })
const storedKey = 'arty-composer-draft:a:home'
const textarea = () => screen.getByPlaceholderText('chat.input.placeholder')
const type = (value: string) => fireEvent.change(textarea(), { target: { value } })

async function setup(isolated: boolean, ready = true) {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: sharedWorkspaceLocks().source })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in draft fixture') }))
  if (isolated) await seedIsolatedWorkspace()
  runtime = await import('../../services/workspaceWriter/runtime')
  await runtime.documentWorkspace.acquire()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
  drafts = await import('../../services/composerDrafts'); erasure = await import('../../services/projects/localErasureGuard')
  // Provision neighbours before injecting historical draft keys. Real keys and
  // ciphertext; no owner/crypto/IDB admission guard is mocked.
  for (const owner of ready ? ['a:b', 'a-b', 'a'] : ['a']) {
    users.setActiveSession(account(owner), { remember: false })
    if (ready) await crypt.initCrypto(`synthetic-${owner}`)
    users.rememberSession(account(owner))
    if (owner !== 'a') {
      const key = `${owner}:home`, text = `neighbour-${owner}`
      drafts.setComposerDraftMemory(key, text)
      localStorage.setItem(drafts.composerDraftStorageKey(key), await crypt.encrypt(text))
    }
  }
  InputBar = (await import('../../components/layout/InputBar')).InputBar
}

afterEach(() => {
  cleanup(); runtime?.documentWorkspace.retire()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

/** Hold real AES output; release also drains the promise chain and IDB probes. */
function hold(method: 'encrypt' | 'decrypt') {
  const gate = deferred(), entered = deferred(), actual = crypto.subtle[method].bind(crypto.subtle)
  vi.spyOn(crypto.subtle, method).mockImplementationOnce(async (...args) => {
    const result = await actual(...args); entered.resolve(); await gate.promise; return result
  })
  return { entered: entered.promise, async release() {
    await act(async () => { gate.resolve(); await new Promise(resolve => setTimeout(resolve, 80)) })
  } }
}
function neighbours() {
  return ['a:b', 'a-b'].map(owner => ({ owner, memory: drafts.getComposerDraft(`${owner}:home`),
    ciphertext: localStorage.getItem(`arty-composer-draft:${owner}:home`) }))
}
async function invalidate(reason: string) {
  if (reason === 'erasure') { const release = erasure.blockProjectOperations('a'); drafts.clearComposerDraft('a:home'); release() }
  else if (reason === 'fence') localStorage.setItem(users.PROJECT_ERASURE_FENCE_KEY, 'changed')
  else if (reason === 'idb') {
    const layout = runtime.getDocumentStorageLayout()
    const db = await openDB(layout.projects.name, layout.projects.version, { upgrade(db) { db.createObjectStore('meta') } })
    await db.put('meta', 'changed', 'erasure-fence'); db.close()
  } else if (reason === 'logout') { drafts.purgeComposerDraftsForActiveUser(); users.clearActiveSession() }
  else if (reason === 'aba') { users.setActiveSession(account('b')); users.setActiveSession(account('a')) }
  else if (reason === 'retire') runtime.documentWorkspace.retire()
}

describe.each([['legacy', false], ['isolated candidate', true]] as const)('real InputBar draft lifetime — %s', (_label, isolated) => {
  it.each(['erasure', 'fence', 'idb', 'logout', 'aba', 'retire', 'unmount'])('rejects a late encrypted write after %s', async reason => {
    await setup(isolated)
    const before = neighbours(), gate = hold('encrypt')
    const view = render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    type('stale private draft'); await gate.entered
    if (reason === 'unmount') view.unmount()
    else await invalidate(reason)
    await gate.release()
    expect(localStorage.getItem(storedKey)).toBeNull()
    expect(neighbours()).toEqual(before)
    if (reason === 'erasure' || reason === 'logout') expect(drafts.getComposerDraft('a:home')).toBeUndefined()
  })

  it.each(['erasure', 'fence', 'idb', 'logout', 'aba', 'retire', 'unmount', 'typed', 'cleared', 'cipher-changed'])('rejects a late decrypted restore after %s', async reason => {
    await setup(isolated)
    const before = neighbours(), ciphertext = await crypt.encrypt('old cold draft')
    localStorage.setItem(storedKey, ciphertext)
    const gate = hold('decrypt'), view = render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    await gate.entered
    if (reason === 'unmount') view.unmount()
    else if (reason === 'typed' || reason === 'cleared') { type('new text'); if (reason === 'cleared') type('') }
    else if (reason === 'cipher-changed') localStorage.setItem(storedKey, 'replacement-ciphertext')
    else await invalidate(reason)
    await gate.release()
    expect(drafts.getComposerDraft('a:home')).toBe(reason === 'typed' ? 'new text' : undefined)
    if (reason !== 'unmount') expect(textarea()).toHaveValue(reason === 'typed' ? 'new text' : '')
    expect(neighbours()).toEqual(before)
  })

  it('binds text to its incarnation when the same component changes conversation keys A -> B -> A', async () => {
    await setup(isolated)
    drafts.setComposerDraftMemory('a:conversation:b', 'B already exists')
    const view = render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    type('A is distinct')
    view.rerender(<InputBar onSend={() => false} isStreaming={false} draftKey="conversation:b" />)
    expect(textarea()).toHaveValue('B already exists')
    expect(drafts.getComposerDraft('a:home')).toBe('A is distinct')
    expect(drafts.getComposerDraft('a:conversation:b')).toBe('B already exists')
    view.rerender(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    expect(textarea()).toHaveValue('A is distinct')
  })

  it.each(['edit', 'remount'])('an old send acknowledgement does not clear a new draft after %s', async mode => {
    await setup(isolated)
    const accepted = deferred<boolean>()
    let view = render(<InputBar onSend={() => accepted.promise} isStreaming={false} draftKey="home" />)
    type('submitted')
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    if (mode === 'remount') { view.unmount(); view = render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />) }
    type('new unsent text')
    await act(async () => { accepted.resolve(true); await accepted.promise })
    expect(textarea()).toHaveValue('new unsent text')
    expect(drafts.getComposerDraft('a:home')).toBe('new unsent text')
  })

  it('round-trips a real cold ciphertext and removes only the current accepted draft', async () => {
    await setup(isolated)
    localStorage.setItem(storedKey, await crypt.encrypt('cold encrypted text'))
    render(<InputBar onSend={() => true} isStreaming={false} draftKey="home" />)
    await vi.waitFor(() => expect(textarea()).toHaveValue('cold encrypted text'))
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).toBeNull())
    expect(drafts.getComposerDraft('a:home')).toBeUndefined()
    expect(textarea()).toHaveValue('')
  })

  it('cleans the exact Home draft after successful navigation, without a mounted Home editor', async () => {
    await setup(isolated)
    const before = neighbours(), accepted = deferred<boolean>(), gate = hold('encrypt')
    const view = render(<InputBar onSend={() => accepted.promise} isStreaming={false} draftKey="home" />)
    type('submitted home text'); await gate.entered
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    view.unmount()
    await act(async () => { accepted.resolve(true); await new Promise(resolve => setTimeout(resolve, 80)) })
    await gate.release()
    expect(drafts.getComposerDraft('a:home')).toBeUndefined()
    expect(localStorage.getItem(storedKey)).toBeNull()
    expect(neighbours()).toEqual(before)
  })

  it('a storage-ready I/O retry is not a new edit and does not revoke an acknowledgement', async () => {
    await setup(isolated)
    const accepted = deferred<boolean>()
    render(<InputBar onSend={() => accepted.promise} isStreaming={false} draftKey="home" />)
    type('submitted text')
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    await act(async () => { window.dispatchEvent(new Event('conversations-storage-ready')) })
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).not.toBeNull())
    await act(async () => { accepted.resolve(true); await new Promise(resolve => setTimeout(resolve, 80)) })
    expect(drafts.getComposerDraft('a:home')).toBeUndefined()
    expect(localStorage.getItem(storedKey)).toBeNull()
    expect(textarea()).toHaveValue('')
  })

  it('a new edit queued at durable removal cannot be cleared by a later UI acknowledgement microtask', async () => {
    await setup(isolated)
    const accepted = deferred<boolean>()
    render(<InputBar onSend={() => accepted.promise} isStreaming={false} draftKey="home" />)
    type('submitted before microtask')
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    const actual = Storage.prototype.removeItem
    let queued = false
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      actual.call(this, key)
      if (key === storedKey && !queued) {
        queued = true
        queueMicrotask(() => type('new text in following microtask'))
      }
    })
    await act(async () => { accepted.resolve(true); await new Promise(resolve => setTimeout(resolve, 80)) })
    expect(queued).toBe(true)
    expect(textarea()).toHaveValue('new text in following microtask')
    expect(drafts.getComposerDraft('a:home')).toBe('new text in following microtask')
  })

  it('locks duplicate sends while a synchronous acceptance waits for its real durable cleanup probe', async () => {
    await setup(isolated)
    const layout = runtime.getDocumentStorageLayout()
    const db = await openDB(layout.projects.name, layout.projects.version, { upgrade(db) { db.createObjectStore('meta') } })
    const tx = db.transaction('meta', 'readwrite')
    let pumping = true
    const pump = () => { void tx.store.get('hold').then(() => { if (pumping) pump() }) }
    pump()
    const onSend = vi.fn(() => true)
    render(<InputBar onSend={onSend} isStreaming={false} draftKey="home" />)
    type('single accepted message')
    const button = screen.getByRole('button', { name: 'chat.input.aria.send' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    pumping = false; await tx.done; db.close()
    await vi.waitFor(() => expect(textarea()).toHaveValue(''))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('retains new attachment intent before its asynchronous preparation finishes', async () => {
    await setup(isolated)
    const accepted = deferred<boolean>(), reading = deferred()
    const actual = FileReader.prototype.readAsDataURL
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, file) {
      void reading.promise.then(() => actual.call(this, file))
    })
    const view = render(<InputBar onSend={() => accepted.promise} isStreaming={false} draftKey="home" />)
    type('already submitted')
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    const input = view.container.querySelector('input[type=file]')!
    const selected = [new File(['new attachment'], 'new.txt', { type: 'text/plain' })]
    fireEvent.change(input, { target: { files: Object.assign(selected, { item: (index: number) => selected[index] ?? null }) } })
    await act(async () => { accepted.resolve(true); await new Promise(resolve => setTimeout(resolve, 80)) })
    expect(textarea()).toHaveValue('already submitted')
    await act(async () => { reading.resolve(); await new Promise(resolve => setTimeout(resolve, 80)) })
    expect(screen.getByText('new.txt')).toBeInTheDocument()
    expect(drafts.getComposerDraft('a:home')).toBe('already submitted')
  })

  it('a touched empty draft is durably cleared before crypto readiness; untouched cold text is retained', async () => {
    await setup(isolated, false)
    localStorage.setItem(storedKey, 'v2:preserved-until-explicit-clear')
    const before = neighbours()
    render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    expect(localStorage.getItem(storedKey)).toBe('v2:preserved-until-explicit-clear')
    type('temporary'); type('')
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).toBeNull())
    expect(neighbours()).toEqual(before)
  })

  it('StrictMode prefill remains editable and a clear is not undone by readiness events', async () => {
    await setup(isolated)
    render(<StrictMode><InputBar onSend={() => false} isStreaming={false} draftKey="home" prefill={{ id: 1, text: 'prefilled' }} /></StrictMode>)
    expect(textarea()).toHaveValue('prefilled')
    type('edited'); type('')
    await act(async () => { window.dispatchEvent(new Event('conversations-storage-ready')) })
    expect(textarea()).toHaveValue('')
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).toBeNull())
    expect(drafts.getComposerDraft('a:home')).toBeUndefined()
  })

  it('retries an explicit clear cancelled by crypto initialization, only when storage becomes ready', async () => {
    await setup(isolated)
    const cold = await crypt.encrypt('cold-payload')
    localStorage.setItem(storedKey, cold)
    users.setActiveSession(account('a')) // same owner, new epoch: persisted key exists, runtime key not ready
    expect(crypt.isCryptoReady()).toBe(false)
    const layout = runtime.getDocumentStorageLayout()
    const db = await openDB(layout.projects.name, layout.projects.version, { upgrade(db) { db.createObjectStore('meta') } })
    const tx = db.transaction('meta', 'readwrite')
    let pumping = true
    const pump = () => { void tx.store.get('hold').then(() => { if (pumping) pump() }) }
    pump()
    render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    type('typed then cleared'); type('')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    const initializing = crypt.initCrypto('synthetic-a') // invalidates the pending removal generation
    pumping = false; await tx.done; db.close()
    await initializing
    expect(localStorage.getItem(storedKey)).toBe(cold)
    await act(async () => { window.dispatchEvent(new Event('conversations-storage-ready')) })
    await vi.waitFor(() => expect(localStorage.getItem(storedKey)).toBeNull())
    expect(textarea()).toHaveValue('')
  })

  it('removal scope is narrow and a failed KDF cannot revive its pre-key capability', async () => {
    await setup(isolated, false)
    const { captureLocalReadScope, captureLocalRemovalScope } = await import('../../services/projects/store')
    expect(() => captureLocalReadScope()).toThrow()
    const scope = captureLocalRemovalScope()
    expect(Object.keys(scope).sort()).toEqual(['assertCurrent', 'validateReadOnly'])
    await scope.validateReadOnly()
    await expect(crypt.initCrypto('synthetic-a', { commit: () => { throw new Error('synthetic failure') } })).rejects.toThrow('synthetic failure')
    expect(crypt.isCryptoReady()).toBe(false)
    expect(() => scope.assertCurrent()).toThrow()
  })

  it('keeps editable RAM-only text before crypto readiness without plaintext persistence', async () => {
    await setup(isolated, false)
    const view = render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    type('RAM only')
    expect(drafts.getComposerDraft('a:home')).toBe('RAM only')
    expect(localStorage.getItem(storedKey)).toBeNull()
    view.unmount(); render(<InputBar onSend={() => false} isStreaming={false} draftKey="home" />)
    expect(textarea()).toHaveValue('RAM only')
  })
})
