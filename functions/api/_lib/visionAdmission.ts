export type VisionAdmissionRelease = () => void

/**
 * Isolate-local, fail-fast admission guard.
 *
 * Large vision requests cannot wait in a JavaScript queue: every waiter would
 * retain an unread request body and recreate the memory pressure this guard is
 * meant to prevent. Cloudflare can route load to other isolates; this isolate
 * admits one request and asks concurrent callers to retry.
 */
export function createVisionAdmission(maxActive = 1): {
  tryAcquire: () => VisionAdmissionRelease | null
  active: () => number
} {
  if (!Number.isInteger(maxActive) || maxActive < 1) {
    throw new Error('maxActive must be a positive integer')
  }
  let active = 0
  return {
    tryAcquire() {
      if (active >= maxActive) return null
      active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        active -= 1
      }
    },
    active: () => active,
  }
}

export function visionBusyResponse(): Response {
  return Response.json(
    { error: 'vision_busy', retry_after_seconds: 1 },
    { status: 429, headers: { 'retry-after': '1' } },
  )
}
