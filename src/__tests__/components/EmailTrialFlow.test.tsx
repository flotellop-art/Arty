import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}))

// Stub du widget Turnstile : un bouton qui, cliqué, simule la résolution du
// défi en remontant un token. Évite de charger le vrai script CF en test.
vi.mock('../../components/auth/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken, onError }: { onToken: (t: string) => void; onError?: () => void }) => (
    <>
      <button type="button" data-testid="ts-solve" onClick={() => onToken('tok-xyz')}>solve</button>
      <button type="button" data-testid="ts-fail" onClick={() => onError?.()}>fail</button>
    </>
  ),
}))

vi.mock('../../services/emailTrialClient', () => {
  class EmailTrialError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  }
  return { EmailTrialError, requestOtp: vi.fn().mockResolvedValue(undefined), verifyOtp: vi.fn() }
})

import { EmailTrialFlow } from '../../components/auth/EmailTrialFlow'
import { requestOtp, verifyOtp } from '../../services/emailTrialClient'

const mockRequestOtp = requestOtp as unknown as ReturnType<typeof vi.fn>

beforeEach(() => { mockRequestOtp.mockClear() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

function typeEmail(value: string) {
  const input = screen.getByLabelText('Ton email') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

describe('EmailTrialFlow — intégration Turnstile (C2/F-10)', () => {
  it.each([0, 17, 30, null, undefined, -1, 31, 1.5])('passes remaining %s (unknown never becomes30) to the new session', async remaining => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.mocked(verifyOtp).mockResolvedValueOnce({ token: 'synthetic', email: 'ab@gmail.com', trial_messages_remaining: remaining })
    const onSuccess = vi.fn(async () => undefined)
    render(<EmailTrialFlow onSuccess={onSuccess} onBack={() => {}} />)
    typeEmail('a.b@gmail.com'); fireEvent.click(screen.getByText(/Recevoir mon code/))
    await screen.findByLabelText('Code à 6 chiffres')
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText(/Vérifier et démarrer/))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('ab@gmail.com', 'synthetic',
      typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0 && remaining <= 30 ? remaining : null))
  })
  it('sitekey ABSENTE : envoie l’OTP sans token (dégradation, pas de widget)', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    render(<EmailTrialFlow onSuccess={async () => {}} onBack={() => {}} />)

    expect(screen.queryByTestId('ts-solve')).toBeNull() // widget non rendu
    typeEmail('user@example.com')
    fireEvent.click(screen.getByText(/Recevoir mon code/))

    await waitFor(() => expect(mockRequestOtp).toHaveBeenCalledTimes(1))
    expect(mockRequestOtp).toHaveBeenCalledWith('user@example.com', undefined)
  })

  it('sitekey PRÉSENTE : le bouton est bloqué tant que le défi n’est pas résolu, puis l’OTP part AVEC le token', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0xSITEKEY')
    render(<EmailTrialFlow onSuccess={async () => {}} onBack={() => {}} />)

    typeEmail('user@example.com')
    const submit = screen.getByText(/Recevoir mon code/).closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true) // pas de token → bloqué

    fireEvent.click(screen.getByTestId('ts-solve')) // résout le défi → token
    await waitFor(() => expect(submit.disabled).toBe(false))

    fireEvent.click(submit)
    await waitFor(() => expect(mockRequestOtp).toHaveBeenCalledTimes(1))
    expect(mockRequestOtp).toHaveBeenCalledWith('user@example.com', 'tok-xyz')
  })

  it('échec du widget (WebView/réseau) : FAIL-OPEN front — le bouton se débloque et l’OTP part sans token (le serveur tranche)', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0xSITEKEY')
    render(<EmailTrialFlow onSuccess={async () => {}} onBack={() => {}} />)

    typeEmail('user@example.com')
    const submit = screen.getByText(/Recevoir mon code/).closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true) // bloqué au départ (pas de token)

    fireEvent.click(screen.getByTestId('ts-fail')) // le widget échoue → fail-open
    await waitFor(() => expect(submit.disabled).toBe(false)) // plus de bouton mort

    fireEvent.click(submit)
    await waitFor(() => expect(mockRequestOtp).toHaveBeenCalledTimes(1))
    expect(mockRequestOtp).toHaveBeenCalledWith('user@example.com', undefined)
  })
})
