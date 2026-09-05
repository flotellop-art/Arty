import { getFile } from './secureFileStorage'
import { beginProjectOperation, assertProjectOperation } from './projects/store'
import { isGeneratedImageId, validGeneratedImage } from './generatedImages'
import { captureCryptoGuard } from './crypto'
import { getActiveSessionEpoch, getActiveUserId, getKnownSessions, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from './userSession'

/** Capture at mount, even when a lazy card will only load much later. */
export function captureGeneratedImageView(): () => void {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch(), cryptoCurrent = captureCryptoGuard(), fence = getSessionProjectFence()
  return () => {
    if (!owner || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch() || !cryptoCurrent() ||
      fence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial') || !getKnownSessions().some(s => s.userId === owner)) {
      throw new DOMException('Image view cancelled', 'AbortError')
    }
  }
}

let reading: Promise<void> = Promise.resolve()
export async function readGeneratedImage(fileId: string, signal: AbortSignal, assertView: () => void) {
  assertView()
  if (!isGeneratedImageId(fileId) || signal.aborted) throw new DOMException('Image unavailable', 'AbortError')
  const operation = await beginProjectOperation() // captures owner/crypto before its first await
  const assertCurrent = () => {
    assertView()
    if (signal.aborted) throw new DOMException('Image cancelled', 'AbortError')
    operation.assertCurrent()
  }
  assertCurrent()
  // Only one large binary decryption at a time; queued reads retain their original scope.
  const previous = reading
  let release!: () => void
  reading = new Promise<void>(resolve => { release = resolve })
  try {
    await previous; assertCurrent()
    const file = await getFile(fileId, operation.owner)
    assertCurrent(); await assertProjectOperation(operation); assertCurrent()
    if (!file || !validGeneratedImage(file.data, file.type)) throw new Error('Image unavailable')
    const binary = atob(file.data), bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: file.type })
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
    assertCurrent()
    return { blob, filename: `arty-image-${fileId}.${extension}`, assertCurrent,
      async validate() { assertCurrent(); await assertProjectOperation(operation); assertCurrent() } }
  } finally { release() }
}
