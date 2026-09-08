import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalMemoryModal } from '../../components/settings/LocalMemoryModal'
import { installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as facts from '../../services/localMemoryService'
import * as scoped from '../../services/scopedStorage'
import * as crypt from '../../services/crypto'
import i18n from '../../i18n'
const input = () => screen.getByRole('textbox', { name: i18n.t('localMemory.modal.addPlaceholder') })
const add = () => screen.getByRole('button', { name: i18n.t('localMemory.modal.addAria') })
const show = async () => { render(<LocalMemoryModal onClose={vi.fn()} />); await waitFor(() => expect(facts.getLocalMemorySnapshot().status).toBe('ready')) }
beforeEach(async () => { await resetCalendarFixture() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('real local memory modal and encrypted storage', () => {
  it('hydrates encrypted facts instead of showing a false empty memory', async () => {
    const a=await facts.addFact('Synthetic A');facts.resetLocalMemoryCache();await show()
    expect(screen.getByRole('button',{name:'Modifier : Synthetic A'})).toBeVisible()
    expect(screen.queryByText(i18n.t('localMemory.modal.empty'))).not.toBeInTheDocument()
    expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([a])
  })
  it('keeps the draft and previous facts on quota failure, then retries one durable add', async () => {
    const a=await facts.addFact('Synthetic A');await show()
    const raw=scoped.getItem('local-memory-facts'), real=scoped.setItem
    const write=vi.spyOn(scoped,'setItem').mockImplementation((key,value)=>{if(key==='local-memory-facts')throw new DOMException('Quota','QuotaExceededError');real(key,value)})
    fireEvent.change(input(),{target:{value:'Synthetic B'}});fireEvent.click(add())
    expect(await screen.findByRole('alert')).toBeVisible();expect(input()).toHaveValue('Synthetic B')
    expect(facts.getAll()).toEqual([a]);expect(scoped.getItem('local-memory-facts')).toBe(raw)
    write.mockRestore();await waitFor(()=>expect(add()).toBeEnabled());fireEvent.click(add())
    await waitFor(()=>expect(input()).toHaveValue(''))
    expect((await scoped.secureGetJSON<facts.LocalMemoryFact[]>('local-memory-facts'))!.map(f=>f.content)).toEqual(['Synthetic A','Synthetic B'])
  })
  it('does not acknowledge or duplicate an add while encryption is pending', async () => {
    await show();const gate=deferred<void>(), real=crypt.encrypt
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    fireEvent.change(input(),{target:{value:'Synthetic B'}})
    act(()=>{fireEvent.keyDown(input(),{key:'Enter'});fireEvent.click(add())})
    await waitFor(()=>expect(encryption).toHaveBeenCalledOnce());expect(input()).toHaveValue('Synthetic B')
    expect(facts.getAll()).toEqual([]);expect(scoped.getItem('local-memory-facts')).toBeNull()
    await act(async()=>{gate.resolve()});await waitFor(()=>expect(input()).toHaveValue(''))
    expect(encryption).toHaveBeenCalledOnce();expect(facts.getAll().map(f=>f.content)).toEqual(['Synthetic B'])
  })
  it('Enter followed by blur commits an edit only once', async () => {
    await facts.addFact('Synthetic A');await show();fireEvent.click(screen.getByRole('button',{name:'Modifier : Synthetic A'}))
    const edit=screen.getByRole('textbox',{name:i18n.t('localMemory.modal.editFieldAria')}), write=vi.spyOn(scoped,'setItem')
    fireEvent.change(edit,{target:{value:'Edited A'}})
    act(()=>{fireEvent.keyDown(edit,{key:'Enter'});fireEvent.blur(edit)})
    await screen.findByRole('button',{name:'Modifier : Edited A'})
    expect(write.mock.calls.filter(([key])=>key==='local-memory-facts')).toHaveLength(1)
  })
  it('clears old drafts and ignores a late A completion after switching to B', async () => {
    const a=await facts.addFact('Synthetic A');await installCalendarAccount('b');const b=await facts.addFact('Synthetic B');await installCalendarAccount('a');await show()
    const gate=deferred<void>(), real=crypt.encrypt
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    fireEvent.change(input(),{target:{value:'Late A'}});fireEvent.click(add());await waitFor(()=>expect(encryption).toHaveBeenCalledOnce())
    await act(async()=>{await installCalendarAccount('b');await facts.bootstrapLocalMemory()})
    await act(async()=>{gate.resolve()})
    await waitFor(()=>expect(input()).toHaveValue(''))
    expect(facts.getAll()).toEqual([b]);expect(screen.queryByText('Synthetic A')).not.toBeInTheDocument()
    await act(async()=>{await installCalendarAccount('a');await facts.bootstrapLocalMemory()});expect(facts.getAll()).toEqual([a])
  })
  it('shows an unavailable state without claiming corrupt ciphertext is empty', async () => {
    scoped.setItem('local-memory-facts','v2:corrupt');render(<LocalMemoryModal onClose={vi.fn()} />)
    await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('unavailable'))
    expect(screen.getByRole('status')).toHaveTextContent(/indisponible/)
    expect(screen.queryByText(i18n.t('localMemory.modal.empty'))).not.toBeInTheDocument();expect(add()).toBeDisabled()
    expect(scoped.getItem('local-memory-facts')).toBe('v2:corrupt')
  })
  it('preserves the draft when the interface language changes',async()=>{
    await show();fireEvent.change(input(),{target:{value:'Unsaved draft'}})
    await act(async()=>{await i18n.changeLanguage('en')})
    expect(input()).toHaveValue('Unsaved draft');expect(add()).toBeEnabled()
  })
  it.each(['fr','en'])('offers a truthful reread after a real delete commits but its ACK throws (%s)',async locale=>{
    await i18n.changeLanguage(locale);await facts.addFact('Synthetic A');await show()
    const real=scoped.setItem
    const write=vi.spyOn(scoped,'setItem').mockImplementationOnce((key,value)=>{real(key,value);throw new Error('lost acknowledgement')})
    fireEvent.click(screen.getByRole('button',{name:i18n.t('localMemory.modal.deleteAria')}))
    fireEvent.click(screen.getByRole('button',{name:i18n.t('localMemory.modal.confirmDeleteAria')}))
    const alert=await screen.findByRole('alert')
    expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([])
    expect(alert).not.toHaveTextContent(/ne sont pas effacés|have not been erased/)
    expect(alert).toHaveTextContent(locale==='fr'?'confirmé':'confirmed')
    fireEvent.click(screen.getByRole('button',{name:i18n.t('localMemory.modal.retry')}))
    await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('localMemory.modal.empty'))).toBeVisible()
    expect(write).toHaveBeenCalledOnce()
  })
  it('ignores an old retry failure after a newer account has loaded',async()=>{
    scoped.setItem('local-memory-facts','v2:corrupt');render(<LocalMemoryModal onClose={vi.fn()} />)
    await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('unavailable'))
    const old=deferred<void>();vi.spyOn(facts,'bootstrapLocalMemory').mockImplementationOnce(()=>old.promise)
    fireEvent.click(screen.getByRole('button',{name:i18n.t('localMemory.modal.retry')}))
    await act(async()=>{await installCalendarAccount('b');await facts.bootstrapLocalMemory()})
    await act(async()=>{old.reject(new Error('old A retry failed'))})
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(facts.getLocalMemorySnapshot().status).toBe('ready')
  })
})
