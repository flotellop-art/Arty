import { describe, expect, it } from 'vitest'
import { buildLocalReportUrl } from '../../services/tools/utilityTools'

describe('utilityTools — URL locale du rapport', () => {
  it.each([
    ['https://tryarty.com', 'https://tryarty.com/report/report-123'],
    ['https://appfacade.pages.dev', 'https://appfacade.pages.dev/report/report-123'],
  ])('conserve le silo de stockage de %s', (origin, expected) => {
    expect(buildLocalReportUrl(origin, 'report-123')).toBe(expected)
  })
})
