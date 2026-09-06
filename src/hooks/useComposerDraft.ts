import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { captureComposerDraftRevision, clearComposerDraft, composerDraftStorageKey, getComposerDraft, setComposerDraftMemory } from '../services/composerDrafts'
import { decrypt, encrypt, isCryptoReady } from '../services/crypto'
import { captureLocalReadScope, captureLocalRemovalScope } from '../services/projects/store'
import { captureOwnerErasureGuard } from '../services/projects/localErasureGuard'
import { getActiveUserId, getActiveSessionEpoch, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from '../services/userSession'
import { assertDocumentWorkspace } from '../services/workspaceWriter/runtime'

/** RAM remains usable before crypto readiness. Durable publication uses the
 * existing read-only project scope: no database creation or repair here. */
export function useComposerDraft(draftKey?: string, initialText?: string) {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  const key = draftKey ? `${owner ?? 'anonymous'}:${draftKey}` : undefined
  // A new binding is a new incarnation, including A -> B -> A. Seed text is
  // deliberately single-shot, just like InputBar's initialText contract.
  const binding = useMemo(() => ({ key, owner, epoch,
    seed: initialText ?? (key ? getComposerDraft(key) ?? '' : ''), touched: Boolean(initialText),
  }), [key, owner, epoch])
  const [value, setValue] = useState(() => ({ binding, text: binding.seed, revision: 0 }))
  const [storageReadyVersion, setStorageReadyVersion] = useState(0)
  const lifetime = useRef<{ binding: typeof binding; revision: number; touched: boolean; alive: boolean; authority: () => void;
    lastWritten?: { revision: number; ciphertext: string | null }; lastMemoryRevision?: number } | null>(null)

  useLayoutEffect(() => {
    let authority: () => void
    try {
      const notErasing = captureOwnerErasureGuard(owner), fence = getSessionProjectFence()
      authority = () => {
        assertDocumentWorkspace(); notErasing()
        if (owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() ||
          (owner !== null && (fence === null || fence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial')))) {
          throw new Error('composer_scope_changed')
        }
      }
      authority()
    } catch {
      authority = () => { throw new Error('composer_scope_unavailable') }
    }
    const life = { binding, revision: 0, touched: binding.touched, alive: true, authority }
    lifetime.current = life
    setValue(current => current.binding === binding ? current : { binding, text: binding.seed, revision: 0 })
    return () => { life.alive = false }
  }, [binding])

  useEffect(() => {
    const retry = () => setStorageReadyVersion(version => version + 1)
    window.addEventListener('conversations-storage-ready', retry)
    return () => window.removeEventListener('conversations-storage-ready', retry)
  }, [])

  /** Capture synchronously, BEFORE an asynchronous send or any storage work. */
  const captureRevision = useCallback(() => {
    const life = lifetime.current, revision = life?.revision
    return () => {
      if (!life?.alive || life.binding !== binding || lifetime.current !== life || life.revision !== revision) return false
      try { life.authority(); return true } catch { return false }
    }
  }, [binding])

  const setText = useCallback((next: SetStateAction<string>) => {
    const life = lifetime.current
    if (!life?.alive || life.binding !== binding) return
    // Increment even for empty -> empty: a clear must revoke a pending restore.
    const revision = ++life.revision
    life.touched = true
    setValue(current => ({ binding, revision, text: typeof next === 'function'
      ? next(current.binding === binding ? current.text : binding.seed) : next }))
  }, [binding])

  useEffect(() => {
    const life = lifetime.current
    if (!key || value.binding !== binding || life?.revision !== value.revision) return
    const current = captureRevision()
    if (!current()) return
    if (!value.text && !life.touched) return // never erase an unread cold draft
    if (life.lastMemoryRevision !== value.revision) {
      setComposerDraftMemory(key, value.text)
      life.lastMemoryRevision = value.revision
    }
    let active = true
    try {
      if (!value.text || isCryptoReady()) {
        const scope = value.text ? captureLocalReadScope() : captureLocalRemovalScope(), storageKey = composerDraftStorageKey(key)
        const previous = localStorage.getItem(storageKey)
        void (async () => {
          const ciphertext = value.text ? await encrypt(value.text) : null
          if (!active || !current()) return
          await scope.validateReadOnly()
          scope.assertCurrent()
          if (!active || !current() || localStorage.getItem(storageKey) !== previous) return
          if (ciphertext === null) localStorage.removeItem(storageKey)
          else localStorage.setItem(storageKey, ciphertext)
          life.lastWritten = { revision: value.revision, ciphertext }
        })().catch(() => { /* keep visible text; never fall back to plaintext */ })
      }
    } catch { /* denied storage/crypto: visible text and allowed RAM remain */ }
    return () => { active = false }
  }, [binding, key, value, captureRevision, storageReadyVersion])

  useEffect(() => {
    if (!key || binding.seed) return
    let active = true, attempt = 0
    const restore = () => {
      const life = lifetime.current
      if (!active || life?.binding !== binding || life.touched || getComposerDraft(key) !== undefined) return
      const current = captureRevision(), readAttempt = ++attempt
      try {
        if (!current() || !isCryptoReady()) return
        const scope = captureLocalReadScope(), storageKey = composerDraftStorageKey(key)
        const ciphertext = localStorage.getItem(storageKey)
        if (!ciphertext) return
        void (async () => {
          const restored = await decrypt(ciphertext)
          if (!active || !current() || !restored || readAttempt !== attempt) return
          await scope.validateReadOnly()
          scope.assertCurrent()
          if (!active || !current() || readAttempt !== attempt || localStorage.getItem(storageKey) !== ciphertext || getComposerDraft(key) !== undefined) return
          const revision = ++life.revision
          setComposerDraftMemory(key, restored)
          life.lastMemoryRevision = revision
          setValue({ binding, text: restored, revision })
        })().catch(() => { /* invalid/unavailable ciphertext is preserved */ })
      } catch { /* unavailable scope/storage is not an empty persisted draft */ }
    }
    restore()
    window.addEventListener('conversations-storage-ready', restore)
    return () => { active = false; window.removeEventListener('conversations-storage-ready', restore) }
  }, [binding, key, captureRevision])

  /** Unlike an in-flight writer, an acknowledgement may outlive navigation.
   * It owns only the exact submitted RAM revision and ciphertext; a newly
   * mounted editor, any edit, erasure or session change revokes that ticket. */
  const captureAcceptedDraft = useCallback((compositionUnchanged: () => boolean, clearCurrentUI: () => void) => {
    const life = lifetime.current, revision = life?.revision
    const memoryCurrent = key ? captureComposerDraftRevision(key) : () => true
    let scope: ReturnType<typeof captureLocalRemovalScope> | undefined
    let previous: string | null = null
    const storageKey = key ? composerDraftStorageKey(key) : undefined
    try {
      if (key && owner !== null) {
        scope = captureLocalRemovalScope()
        previous = localStorage.getItem(storageKey!)
      }
    } catch { return () => false }
    const unchanged = () => {
      if (!life || life.binding !== binding || life.revision !== revision || !memoryCurrent() || !compositionUnchanged()) return false
      try {
        life.authority()
        if (scope && storageKey) {
          scope.assertCurrent()
          const ciphertext = localStorage.getItem(storageKey)
          if (ciphertext !== previous && !(life.lastWritten?.revision === revision && life.lastWritten.ciphertext === ciphertext)) return false
        }
        return true
      } catch { return false }
    }
    const finish = () => {
      if (!unchanged() || !life) return false
      const cleanedRevision = ++life.revision // revoke any encryption still in flight before removal
      if (key) {
        if (scope) clearComposerDraft(key)
        else setComposerDraftMemory(key, '') // anonymous RAM has no durable authority
      }
      // No promise/await between the last validation and UI consumption.
      if (life.alive && lifetime.current === life && life.revision === cleanedRevision && compositionUnchanged()) {
        life.authority()
        clearCurrentUI()
      }
      return true
    }
    return (): boolean | Promise<boolean> => {
      if (!unchanged()) return false
      return scope ? scope.validateReadOnly().then(finish).catch(() => false) : finish()
    }
  }, [binding, key, owner])

  return { text: value.binding === binding ? value.text : binding.seed, setText, captureRevision, captureAcceptedDraft, binding }
}
