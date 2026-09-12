import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { platform } from './platform'
import i18n from '../../i18n'

interface GenerationPlugin {
  acquire(options: { token: string }): Promise<void>
  release(options: { token: string }): Promise<void>
  addListener(event: 'expired', listener: (event: { token: string }) => void): Promise<PluginListenerHandle>
}
const native = registerPlugin<GenerationPlugin>('BackgroundGeneration')
const expirations = new Map<string, () => void>()
let listening: Promise<PluginListenerHandle> | undefined

export interface GenerationLease { ready: Promise<void>; release(): void; retain(): () => void }
export class BackgroundGenerationError extends Error {
  constructor() { super(i18n.t('errors.backgroundGenerationUnavailable')); this.name = 'BackgroundGenerationError' }
}

/** The native service knows only random lease IDs, never chat content or credentials. */
export function acquireGeneration(onExpired: () => void): GenerationLease {
  if (platform !== 'android') return { ready: Promise.resolve(), release() {}, retain: () => () => {} }
  const token = crypto.randomUUID()
  let released = false
  let references = 1
  let acquired = false
  const releaseNative = () => { void native.release({ token }).catch(() => { /* Native lease also expires. */ }) }
  expirations.set(token, onExpired)
  listening ??= native.addListener('expired', event => {
    const callback = expirations.get(event.token)
    expirations.delete(event.token)
    callback?.()
  }).catch(error => { listening = undefined; throw error })
  const ready = listening.then(async () => {
    if (released) throw new DOMException('Generation cancelled', 'AbortError')
    await native.acquire({ token })
    acquired = true
    if (released) {
      releaseNative()
      throw new DOMException('Generation cancelled', 'AbortError')
    }
  }).catch(error => {
    expirations.delete(token)
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error
    throw new BackgroundGenerationError()
  })
  // Reservation is synchronous; callers await ready before issuing requests.
  // Attach a handler immediately, including for a reservation cancelled early.
  void ready.catch(() => {})
  const releaseReference = () => {
    if (--references !== 0) return
    released = true; expirations.delete(token)
    if (acquired) releaseNative()
  }
  let primaryReleased = false
  return { ready, release() {
    if (primaryReleased) return
    primaryReleased = true; releaseReference()
  }, retain() {
    if (released) throw new DOMException('Generation cancelled', 'AbortError')
    references++
    let retained = true
    return () => { if (retained) { retained = false; releaseReference() } }
  } }
}
