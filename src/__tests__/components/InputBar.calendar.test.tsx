import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from '../../components/layout/InputBar'
import { created, installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../hooks/useSpeechRecognition', () => ({ useSpeechRecognition: () => ({ isListening: false, interimTranscript: '', error: null, isSupported: false, startListening: vi.fn(), stopListening: vi.fn() }) }))
vi.mock('../../services/native/platform', () => ({ isNative: false }))
vi.mock('../../services/native/camera', () => ({ takePhoto: vi.fn(async () => null), scanDocument: vi.fn(async () => null) }))
vi.mock('../../services/promptEnhancer', () => ({ enhancePrompt: vi.fn(), canEnhancePrompt: () => false }))
vi.mock('../../services/promptEnhancerSettings', () => ({ isPromptEnhancementEnabled: () => false }))
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn(async () => {}) }))
beforeEach(resetCalendarFixture)
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe.each([true, false])('InputBar Calendar v2=%s — real capture/form/transport', v2 => {
  const mount = (documentary = false) => {
    localStorage.setItem('arty-inputbar-v2', v2 ? '1' : '0')
    return render(<InputBar onSend={vi.fn()} isStreaming={false} initialText="Rendez-vous demain à 9h" hasProjectContext={documentary} />)
  }
  it('opens the same account-bound review, preserves the composer, sends one exact payload', async () => {
    const fetcher = vi.fn(async () => created()); vi.stubGlobal('fetch', fetcher)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^Créer$/ }))
    fireEvent.change(screen.getByLabelText('Début (Paris)'), { target: { value: '2026-08-13T09:00' } })
    fireEvent.change(screen.getByLabelText('Fin (Paris)'), { target: { value: '2026-08-13T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant envoi' }))
    expect(screen.getByText(/Compte Google : a@example.invalid/)).toHaveTextContent('2026-08-13T10:00:00+02:00')
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Créer un rendez-vous' })).not.toBeInTheDocument())
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ calendarAccount: 'a@example.invalid', title: 'Rendez-vous demain à 9h', start: '2026-08-13T09:00:00+02:00' })
    expect(screen.getByRole('textbox')).toHaveValue('Rendez-vous demain à 9h')
  })
  it('cancels without any HTTP and never rebinds a form opened before relink', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    mount(); fireEvent.click(await screen.findByRole('button', { name: /^Créer$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /^Créer$/ }))
    await act(async () => installCalendarAccount('b'))
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant envoi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Action non envoyée')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps documentary composer inert for Calendar', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    mount(true)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: /^Créer$/ })).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
