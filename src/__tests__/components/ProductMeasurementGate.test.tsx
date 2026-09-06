import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PRODUCT_MEASUREMENT_RELEASED, PRODUCT_MEASUREMENT_PATH } from '../../services/productMeasurementProtocol'
import { ProductMeasurementSetting } from '../../components/settings/ProductMeasurementSetting'
import { beginClientReplyMeasurement, productMeasurementAvailable, setProductMeasurementEnabled } from '../../services/productMeasurement'
import { onRequest } from '../../../functions/api/measurement/client-reply-v1'

it('keeps publication closed independently of local consent, without auth, reads or writes on the server', async () => {
  expect(PRODUCT_MEASUREMENT_RELEASED).toBe(false)
  render(<ProductMeasurementSetting />); expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  try {
    expect(productMeasurementAvailable()).toBe(false)
    expect(() => setProductMeasurementEnabled(true)).toThrow()
    beginClientReplyMeasurement().settle('saved'); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled()
    const request = new Request('https://tryarty.com' + PRODUCT_MEASUREMENT_PATH, { method: 'POST', body: 'private unparsed body' })
    const env = new Proxy({}, { get() { throw new Error('closed gate must not inspect bindings') } })
    const result = await onRequest({ request, env } as never)
    expect(result.status).toBe(404); expect(request.bodyUsed).toBe(false); expect(fetcher).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
