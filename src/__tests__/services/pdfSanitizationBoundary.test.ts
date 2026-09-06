import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const raster = vi.hoisted(() => vi.fn())
vi.mock('html2canvas', () => ({ default: raster }))
import { exportHtmlAsPdf } from '../../services/conversationExport'
import { getReport, saveReport } from '../../services/reportGenerator'
import { initCrypto } from '../../services/crypto'
import { setActiveSession } from '../../services/userSession'

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  setActiveSession({ userId: 'pdf-boundary', authMethod: 'apikey', displayName: 'Synthetic', createdAt: 1 })
  await initCrypto('SYNTHETIC-NOT-A-CREDENTIAL')
})
afterEach(() => { vi.restoreAllMocks() })

describe('PDF sanitization at the connected rasterization boundary', () => {
  it.each(['stored-report', 'generic-html'])('removes executable content before %s is attached, preserves style, and cleans up after a raster failure', async path => {
    const dirty = '<h1>Safe title</h1><p style="width:75%">Safe text</p><svg onload="alert(1)"></svg><img src="data:image/png;base64,invalid" onerror="alert(2)"><script>alert(3)</script><a href="javascript:alert(4)">Link</a>'
    const html = path === 'stored-report'
      ? (await getReport(await saveReport('Safe report', `${dirty}<img src="https://tracker.example/secret">`)))!
      : `<html><head><style>p { color: red }</style></head><body>${dirty}</body></html>`
    const failure = new Error('Synthetic raster failure')
    let attached: HTMLElement | undefined
    raster.mockImplementation(async (container: HTMLElement) => {
      attached = container
      expect(container.isConnected).toBe(true)
      expect(container.textContent).toContain('Safe title')
      expect(container.querySelector('style')).not.toBeNull()
      expect(container.querySelector('p')?.getAttribute('style')).toContain('width:75%')
      expect(container.querySelector('script, iframe')).toBeNull()
      for (const element of container.querySelectorAll('*')) for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i)
        expect(attribute.value).not.toMatch(/^javascript:/i)
      }
      if (path === 'stored-report') expect(container.innerHTML).not.toContain('tracker.example')
      throw failure
    })
    await expect(exportHtmlAsPdf(html, 'synthetic')).rejects.toBe(failure)
    expect(raster).toHaveBeenCalledOnce()
    expect(attached).toBeDefined()
    expect(attached!.isConnected).toBe(false)
  })
})
