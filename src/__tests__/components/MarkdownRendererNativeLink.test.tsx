import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { browserOpen } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
}))
const session = vi.hoisted(() => ({ owner: 'a' as string | null, epoch: 1 }))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => session.owner,
  getActiveSessionEpoch: () => session.epoch,
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

const reportId = '91fe72b8-8dca-4d4f-a8c0-8184f971f298'
const reportPath = `/report/${reportId}`
const reportKey = `arty-a-report-${reportId}`
const reportUrl = `${location.origin}${reportPath}`
function reportChat(content: string, historical = false) {
  return <MemoryRouter initialEntries={['/chat']}><Routes>
    <Route path="/chat" element={<MarkdownRenderer content={content} historical={historical} />} />
    <Route path="/report/:id" element={<p>Page du rapport local</p>} />
  </Routes></MemoryRouter>
}

describe('MarkdownRenderer, liens Android', () => {
  beforeEach(() => {
    localStorage.clear()
    session.owner = 'a'
    session.epoch = 1
    browserOpen.mockReset()
    browserOpen.mockResolvedValue(undefined)
  })

  it.each([reportUrl, reportPath])('navigates to the saved report inside the app: %s', href => {
    localStorage.setItem(reportKey, 'v2:encrypted')
    render(reportChat(`[Rapport](${href})`))
    expect(screen.getByRole('link', { name: 'Rapport' })).not.toHaveAttribute('target')
    fireEvent.click(screen.getByRole('link', { name: 'Rapport' }))
    expect(screen.getByText('Page du rapport local')).toBeVisible()
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('recovers a stored URL neutralized by an older fact-checker without rewriting its text', () => {
    localStorage.setItem(reportKey, 'v2:encrypted')
    const { container } = render(reportChat(`Ouvrir le rapport (\`${reportUrl}\` *(non vérifié)*)`))
    expect(container.querySelector('code')?.textContent).toBe(reportUrl)
    fireEvent.click(screen.getByRole('link', { name: /ouvrir le rapport/i }))
    expect(screen.getByText('Page du rapport local')).toBeVisible()
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it.each(['deleted', 'account', 'session'] as const)('refuses navigation when %s changes after render', change => {
    localStorage.setItem(reportKey, 'v2:encrypted')
    render(reportChat(`[Rapport](${reportUrl})`))
    if (change === 'deleted') localStorage.removeItem(reportKey)
    if (change === 'account') {
      session.owner = 'b'
      localStorage.setItem(`arty-b-report-${reportId}`, 'v2:other-account')
    }
    if (change === 'session') session.epoch++
    fireEvent.click(screen.getByRole('link', { name: 'Rapport' }))
    expect(screen.queryByText('Page du rapport local')).toBeNull()
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it.each([false, true])('never opens a missing local report in an external browser (other account=%s)', otherAccount => {
    if (otherAccount) localStorage.setItem(`arty-b-report-${reportId}`, 'v2:encrypted')
    render(reportChat(`[Rapport](${reportUrl})`))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/rapport indisponible sur cet appareil/i)).toBeVisible()
    fireEvent.click(screen.getByText(/rapport indisponible sur cet appareil/i))
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('does not activate archived links, archived inline code or fenced code', () => {
    localStorage.setItem(reportKey, 'v2:encrypted')
    const { rerender } = render(reportChat(`[Rapport](${reportUrl})\n\n\`${reportUrl}\``, true))
    expect(screen.queryByRole('link')).toBeNull()
    rerender(reportChat(`\`\`\`\n${reportUrl}\n\`\`\``))
    expect(screen.queryByRole('link')).toBeNull()
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('keeps a saved local link inert when rendered outside the app router', () => {
    localStorage.setItem(reportKey, 'v2:encrypted')
    render(<MarkdownRenderer content={`[Rapport](${reportUrl})`} />)
    expect(screen.queryByRole('link')).toBeNull()
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
