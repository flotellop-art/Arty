import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomInstructionsField } from '../../components/settings/CustomInstructionsField'
import { SettingsModal } from '../../components/settings/SettingsModal'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as instructions from '../../services/customInstructions'
import * as scoped from '../../services/scopedStorage'
import * as crypt from '../../services/crypto'
import i18n from '../../i18n'
const label = () => i18n.t('settings.customInstructions.title')
const input = () => screen.getByRole('textbox', { name: new RegExp(label()) })
const button = (key: string) => screen.getByRole('button', { name: i18n.t(`settings.customInstructions.${key}`) })
async function show() { const view = render(<CustomInstructionsField />); await waitFor(() => expect(input()).toBeEnabled()); return view }
beforeEach(async () => { await resetCalendarFixture() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real instructions field and encrypted persistence', () => {
  it('keeps the draft and revokes a timed-out write before its encryption resumes', async () => {
    await instructions.setCustomInstructions('Original'); await show()
    const gate = deferred<void>(), real = crypt.encrypt
    const encryption = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async text => { const cipher = await real(text); await gate.promise; return cipher })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(input(), { target: { value: 'Timed out draft' } }); fireEvent.click(button('save'))
    await vi.waitFor(() => expect(encryption).toHaveBeenCalledOnce())
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByRole('alert')).toBeVisible(); expect(input()).toHaveValue('Timed out draft')
    await act(async () => { gate.resolve() }); vi.useRealTimers()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Original')
    expect(input()).toHaveValue('Timed out draft'); expect(button('save')).toBeDisabled()
  })
  it.each(['workspaceArchive.verifyTitle', 'workspaceRestore.title'])('guards the real Settings subview transition %s after a save failure', async key => {
    await instructions.setCustomInstructions('Original')
    const close = vi.fn(); render(<SettingsModal open onClose={close} />)
    await waitFor(() => expect(input()).toBeEnabled())
    vi.spyOn(scoped, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    fireEvent.change(input(), { target: { value: 'Do not lose this draft' } }); fireEvent.blur(input())
    await screen.findByRole('alert')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t(key) }))
    expect(confirm).toHaveBeenCalledOnce(); expect(input()).toHaveValue('Do not lose this draft'); expect(close).not.toHaveBeenCalled()
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: i18n.t(key) }))
    expect(screen.queryByRole('textbox', { name: new RegExp(label()) })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('workspaceArchive.backSettings') })).toBeVisible()
    expect(close).not.toHaveBeenCalled(); expect(await scoped.secureGetJSON('custom-instructions')).toBe('Original')
  })
  it('updates a clean editor from new durable content, but preserves and marks a stale draft', async () => {
    await instructions.setCustomInstructions('Original'); await show()
    await act(async () => { await instructions.setCustomInstructions('New saved value') })
    await waitFor(() => expect(input()).toHaveValue('New saved value'))
    expect(screen.getByText(i18n.t('settings.customInstructions.stored'))).toBeVisible()
    fireEvent.change(input(), { target: { value: 'My draft' } })
    await act(async () => { await instructions.setCustomInstructions('Another saved value') })
    expect(input()).toHaveValue('My draft'); expect(button('reread')).toBeEnabled()
    expect(screen.getByText(i18n.t('settings.customInstructions.stale'))).toBeVisible()
    expect(screen.queryByText(i18n.t('settings.customInstructions.stored'))).not.toBeInTheDocument()
  })
  it('loads the exact saved text and never rewrites an unedited focus/blur', async () => {
    const value = 'Vouvoie-moi.\nUnités m² et €. 🧱'; await instructions.setCustomInstructions(value)
    const raw = scoped.getItem('custom-instructions'); instructions.resetCustomInstructionsCache()
    const write = vi.spyOn(scoped, 'setItem'), view = await show()
    expect(input()).toHaveValue(value); fireEvent.focus(input()); fireEvent.blur(input())
    expect(write).not.toHaveBeenCalled(); expect(scoped.getItem('custom-instructions')).toBe(raw)
    view.unmount(); instructions.resetCustomInstructionsCache(); await show()
    expect(input()).toHaveValue(value); expect(write).not.toHaveBeenCalled()
  })
  it('saves a changed blur and click only once and can explicitly clear the value', async () => {
    await instructions.setCustomInstructions('Original'); await show()
    const write = vi.spyOn(scoped, 'setItem')
    fireEvent.change(input(), { target: { value: 'Updated' } })
    act(() => { fireEvent.blur(input()); fireEvent.click(button('save')) })
    await waitFor(() => expect(button('save')).toBeDisabled())
    await waitFor(() => expect(instructions.getCustomInstructions()).toBe('Updated'))
    expect(write).toHaveBeenCalledOnce()
    await waitFor(() => expect(input()).toBeEnabled()); fireEvent.change(input(), { target: { value: '' } }); fireEvent.click(button('save'))
    await waitFor(() => expect(instructions.getCustomInstructions()).toBe(''))
    expect(await scoped.secureGetJSON('custom-instructions')).toBe(''); expect(write).toHaveBeenCalledTimes(2)
  })
  it('preserves the draft on quota failure and prevents accidental blur retries until reread', async () => {
    await instructions.setCustomInstructions('Original'); await show(); const raw = scoped.getItem('custom-instructions')
    const write = vi.spyOn(scoped, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    fireEvent.change(input(), { target: { value: 'Draft' } }); fireEvent.blur(input())
    expect(await screen.findByRole('alert')).toBeVisible(); expect(input()).toHaveValue('Draft')
    fireEvent.blur(input()); expect(write).toHaveBeenCalledOnce(); expect(scoped.getItem('custom-instructions')).toBe(raw)
    fireEvent.click(button('reread')); await waitFor(() => expect(button('save')).toBeEnabled())
    expect(input()).toHaveValue('Draft'); expect(write).toHaveBeenCalledOnce()
    fireEvent.click(button('save')); await waitFor(() => expect(instructions.getCustomInstructions()).toBe('Draft'))
    expect(write).toHaveBeenCalledTimes(2)
  })
  it('recovers a committed write after lost acknowledgement by rereading, not writing again', async () => {
    await instructions.setCustomInstructions('Original'); await show(); const real = scoped.setItem
    const write = vi.spyOn(scoped, 'setItem').mockImplementationOnce((key, value) => { real(key, value); throw new Error('lost acknowledgement') })
    fireEvent.change(input(), { target: { value: 'Committed' } }); fireEvent.click(button('save'))
    await screen.findByRole('alert'); expect(input()).toHaveValue('Committed')
    fireEvent.click(button('reread')); await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(input()).toHaveValue('Committed'); expect(button('save')).toBeDisabled()
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Committed'); expect(write).toHaveBeenCalledOnce()
  })
  it('requires an explicit conflict decision for two editors in the same account', async () => {
    await instructions.setCustomInstructions('Original')
    const view = render(<><section data-testid="first"><CustomInstructionsField /></section><section data-testid="second"><CustomInstructionsField /></section></>)
    const first = within(view.getByTestId('first')), second = within(view.getByTestId('second'))
    await waitFor(() => expect(first.getByRole('textbox')).toBeEnabled()); await waitFor(() => expect(second.getByRole('textbox')).toBeEnabled())
    fireEvent.change(second.getByRole('textbox'), { target: { value: 'Older draft' } })
    fireEvent.change(first.getByRole('textbox'), { target: { value: 'Newer saved' } }); fireEvent.blur(first.getByRole('textbox'))
    await waitFor(() => expect(instructions.getCustomInstructions()).toBe('Newer saved'))
    fireEvent.blur(second.getByRole('textbox')); await second.findByRole('alert')
    expect(instructions.getCustomInstructions()).toBe('Newer saved')
    fireEvent.click(second.getByRole('button', { name: i18n.t('settings.customInstructions.reread') }))
    await second.findByText(i18n.t('settings.customInstructions.conflict'))
    expect(second.getByRole('textbox')).toHaveValue('Older draft'); fireEvent.blur(second.getByRole('textbox'))
    expect(instructions.getCustomInstructions()).toBe('Newer saved')
    fireEvent.click(second.getByRole('button', { name: i18n.t('settings.customInstructions.replace') }))
    await waitFor(() => expect(instructions.getCustomInstructions()).toBe('Older draft'))
  })
  it('does not edit corrupt data or describe it as an empty saved value', async () => {
    scoped.setItem('custom-instructions', 'v2:corrupt'); render(<CustomInstructionsField />)
    await screen.findByRole('alert'); expect(input()).toBeDisabled(); expect(button('save')).toBeDisabled()
    expect(screen.queryByText(i18n.t('settings.customInstructions.stored'))).not.toBeInTheDocument()
    expect(scoped.getItem('custom-instructions')).toBe('v2:corrupt')
  })
  it('retains a draft during a UI language change', async () => {
    await show(); fireEvent.change(input(), { target: { value: 'Unsaved draft' } })
    await act(async () => { await i18n.changeLanguage('en') })
    expect(input()).toHaveValue('Unsaved draft'); expect(button('save')).toBeEnabled()
  })
  it('asks before discarding a draft and retires an in-flight save on unmount', async () => {
    await instructions.setCustomInstructions('Original'); const closeGuard = { current: () => true }
    const view = render(<CustomInstructionsField closeGuard={closeGuard} />)
    await waitFor(() => expect(input()).toBeEnabled())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(input(), { target: { value: 'Unsaved draft' } }); expect(closeGuard.current()).toBe(false); expect(confirm).toHaveBeenCalledOnce()
    const gate = deferred<void>(), real = crypt.encrypt
    const encrypt = vi.spyOn(crypt, 'encrypt').mockImplementationOnce(async value => { const cipher = await real(value); await gate.promise; return cipher })
    fireEvent.click(button('save')); await waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
    view.unmount(); await act(async () => { gate.resolve() })
    expect(await scoped.secureGetJSON('custom-instructions')).toBe('Original')
  })
})
