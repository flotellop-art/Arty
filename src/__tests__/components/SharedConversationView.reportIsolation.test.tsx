import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedConversationView } from '../../components/share/SharedConversationView'
import { LocalReportNavigationContext } from '../../components/shared/LocalReportNavigationContext'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

describe('public shares never inherit private report navigation', () => {
  it.each([false, true])('keeps report links and inline recovery inert (private parent=%s)', privateParent => {
    const id = '91fe72b8-8dca-4d4f-a8c0-8184f971f298'
    const path = `/report/${id}`
    const href = `${location.origin}${path}`
    localStorage.setItem(`arty-a-report-${id}`, 'v2:encrypted')
    const readStorage = vi.spyOn(Storage.prototype, 'getItem')
    const resolver = vi.fn(() => ({ path, canNavigate: () => true }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ title: 'Public', payload: {
      title: 'Public', messages: [{ role: 'assistant', content: `[Rapport local](${href})\n\n\`${href}\`` }],
    } }) })))
    render(<MemoryRouter initialEntries={['/share/example']}>
      <LocalReportNavigationContext.Provider value={privateParent ? resolver : null}>
        <Routes><Route path="/share/:id" element={<SharedConversationView />} /></Routes>
      </LocalReportNavigationContext.Provider>
    </MemoryRouter>)
    return screen.findByText('Public').then(() => {
      expect(screen.queryByRole('link', { name: /rapport/i })).toBeNull()
      expect(resolver).not.toHaveBeenCalled()
      expect(readStorage).not.toHaveBeenCalled()
    })
  })
})
