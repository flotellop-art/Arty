import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => 'a' }))

const { browserOpen } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}))

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: browserOpen,
  },
}))

import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'

describe('MarkdownRenderer, liens Android', () => {
  beforeEach(() => {
    localStorage.clear()
    browserOpen.mockReset()
    browserOpen.mockResolvedValue(undefined)
  })

  it('opens a saved report inside the app and revalidates deletion at click time', () => {
    const id = '91fe72b8-8dca-4d4f-a8c0-8184f971f298'
    const key = `arty-a-report-${id}`
    localStorage.setItem(key, 'encrypted')
    render(<MemoryRouter><Routes>
      <Route path="/" element={<MarkdownRenderer content={`[Rapport](${location.origin}/report/${id})`} />} />
      <Route path="/report/:id" element={<p>Local report page</p>} />
    </Routes></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Rapport' })
    localStorage.removeItem(key)
    fireEvent.click(link)
    expect(screen.queryByText('Local report page')).not.toBeInTheDocument()
    localStorage.setItem(key, 'encrypted')
    fireEvent.click(link)
    expect(screen.getByText('Local report page')).toBeInTheDocument()
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('ouvre une source http/https dans le navigateur natif Capacitor', async () => {
    render(
      <MarkdownRenderer content="[Source vérifiée](https://example.com/article)" />,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Source vérifiée' }))

    await waitFor(() => {
      expect(browserOpen).toHaveBeenCalledWith({
        url: 'https://example.com/article',
      })
    })
  })
})
