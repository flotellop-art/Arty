import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { OAuthCallback } from '../../components/google/OAuthCallback'

function renderCallback(path: string, onCallback: (code: string) => Promise<void>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/callback" element={<OAuthCallback onCallback={onCallback} />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('OAuthCallback — state CSRF single-use', () => {
  it('échange le code une seule fois quand le state correspond', async () => {
    sessionStorage.setItem('arty-oauth-state', 'expected-state')
    const onCallback = vi.fn(async () => {})

    renderCallback('/auth/callback?code=google-code&state=expected-state', onCallback)

    await waitFor(() => expect(onCallback).toHaveBeenCalledOnce())
    expect(onCallback).toHaveBeenCalledWith('google-code')
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(sessionStorage.getItem('arty-oauth-state')).toBeNull()
  })

  it('refuse un state différent et ne transmet jamais le code', async () => {
    sessionStorage.setItem('arty-oauth-state', 'expected-state')
    const onCallback = vi.fn(async () => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderCallback('/auth/callback?code=attacker-code&state=forged-state', onCallback)

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(onCallback).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('arty-oauth-state')).toBeNull()
    expect(warn).toHaveBeenCalledWith('[OAuthCallback] state mismatch — rejecting callback')
    warn.mockRestore()
  })

  it('refuse un callback sans state', async () => {
    sessionStorage.setItem('arty-oauth-state', 'expected-state')
    const onCallback = vi.fn(async () => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderCallback('/auth/callback?code=code-without-state', onCallback)

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(onCallback).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('arty-oauth-state')).toBeNull()
    warn.mockRestore()
  })

  it('refuse le replay d’un callback déjà consommé', async () => {
    sessionStorage.setItem('arty-oauth-state', 'single-use-state')
    const onCallback = vi.fn(async () => {})
    const first = renderCallback(
      '/auth/callback?code=first-code&state=single-use-state',
      onCallback,
    )
    await waitFor(() => expect(onCallback).toHaveBeenCalledOnce())
    first.unmount()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderCallback('/auth/callback?code=replayed-code&state=single-use-state', onCallback)
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(onCallback).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
