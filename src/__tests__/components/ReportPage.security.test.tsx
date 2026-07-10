import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/reportGenerator', () => ({
  getReport: vi.fn(async () => '<!DOCTYPE html><html><body>safe report</body></html>'),
}))
vi.mock('../../services/conversationExport', () => ({
  exportHtmlAsPdf: vi.fn(async () => {}),
}))
vi.mock('../../services/crypto', () => ({ isCryptoReady: () => true }))

import { ReportPage } from '../../components/shared/ReportPage'

describe('ReportPage sandbox', () => {
  it('keeps controls in React and grants no script capability to report HTML', async () => {
    render(
      <MemoryRouter initialEntries={['/report/test-id']}>
        <Routes>
          <Route path="/report/:id" element={<ReportPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const frame = await screen.findByTitle('Rapport')
    expect(frame.getAttribute('sandbox')).toBe('allow-popups')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(screen.getByRole('button', { name: /retour/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /télécharger pdf/i })).toBeInTheDocument()
  })
})
