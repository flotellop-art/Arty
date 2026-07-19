// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createVisionAdmission, visionBusyResponse } from '../../../functions/api/_lib/visionAdmission'

describe('visionAdmission', () => {
  it('admet une seule requête, refuse sans file et rend le permis une fois', () => {
    const admission = createVisionAdmission(1)
    const release = admission.tryAcquire()
    expect(release).toBeTypeOf('function')
    expect(admission.active()).toBe(1)
    expect(admission.tryAcquire()).toBeNull()

    release?.()
    release?.()
    expect(admission.active()).toBe(0)
    expect(admission.tryAcquire()).toBeTypeOf('function')
  })

  it('retourne un refus transitoire stable', async () => {
    const response = visionBusyResponse()
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('1')
    await expect(response.json()).resolves.toEqual({
      error: 'vision_busy',
      retry_after_seconds: 1,
    })
  })
})
