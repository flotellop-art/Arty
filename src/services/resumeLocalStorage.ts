import { captureCryptoGuard, isCryptoReady } from './crypto'
import { bootstrapGoogleStorage, isGoogleStorageReady } from './googleAuth'
import { bootstrapConversationStorage, isCacheReady } from './storage'
import { bootstrapFileStorage } from './secureFileStorage'

/** Resume a cancelled cold bootstrap, not a reload of already unlocked caches.
 * Do not force old ciphertext through a deliberately changed credential.
 * null = superseded, false = optional loading failed, true = calls fulfilled.
 * No new login or token exchange is performed here.
 */
export async function resumePendingLocalStorage(): Promise<boolean | null> {
  if (!isCryptoReady()) return null
  const current = captureCryptoGuard()
  try {
    const results = await Promise.allSettled([
      isGoogleStorageReady() ? Promise.resolve() : bootstrapGoogleStorage(),
      isCacheReady() ? Promise.resolve() : bootstrapConversationStorage(),
      bootstrapFileStorage(),
    ])
    return current() ? results.every(result => result.status === 'fulfilled') : null
  } catch { return current() ? false : null }
}
