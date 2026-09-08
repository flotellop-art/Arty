import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CustomInstructionsField } from '../../components/settings/CustomInstructionsField'
import { useAuth } from '../../hooks/useAuth'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as users from '../../services/userSession'
import * as crypt from '../../services/crypto'
import * as scoped from '../../services/scopedStorage'
import * as instructions from '../../services/customInstructions'
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))
const passphrase = 'synthetic-instruction-auth-key'
async function seed(email: string, text: string) {
  const owner = await users.generateUserId('email', email)
  users.setActiveSession({ userId: owner, authMethod: 'email', displayName: 'Synthetic', email, createdAt: 1 })
  await crypt.initCrypto(passphrase); scoped.setJSON('api-keys', { anthropic: passphrase })
  await instructions.setCustomInstructions(text); return owner
}
beforeEach(async () => { await resetCalendarFixture(); users.clearActiveSession(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external HTTP forbidden') })) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('retires the actual field and its pending edit across real useAuth A-B-A switches', async () => {
  const b = await seed('instructions-b@example.invalid', 'B ONLY'), a = await seed('instructions-a@example.invalid', 'A ONLY')
  function AppSurface() {
    const auth = useAuth()
    return <><button onClick={() => { void auth.switchAccount(b) }}>Switch B</button><button onClick={() => { void auth.switchAccount(a) }}>Switch A</button>
      {auth.currentUser && <CustomInstructionsField key={auth.currentUser.userId} />}</>
  }
  render(<AppSurface />); await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('A ONLY'))
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
  const rawA = scoped.getItem('custom-instructions'), gate = deferred<void>(), real = crypt.encrypt
  const encryption = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async text => { const cipher = await real(text); await gate.promise; return cipher })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'LATE PRIVATE A' } }); fireEvent.blur(screen.getByRole('textbox'))
  await waitFor(() => expect(encryption).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole('button', { name: 'Switch B' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('B ONLY'))
  const rawB = scoped.getItem('custom-instructions')
  await act(async () => { gate.resolve() })
  expect(screen.getByRole('textbox')).toHaveValue('B ONLY'); expect(scoped.getItem('custom-instructions')).toBe(rawB)
  fireEvent.click(screen.getByRole('button', { name: 'Switch A' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('A ONLY'))
  expect(scoped.getItem('custom-instructions')).toBe(rawA); expect(fetch).not.toHaveBeenCalled()
})
