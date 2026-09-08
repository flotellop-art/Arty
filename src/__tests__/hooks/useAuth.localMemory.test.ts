import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../hooks/useAuth'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import * as users from '../../services/userSession'
import * as crypt from '../../services/crypto'
import * as scoped from '../../services/scopedStorage'
import * as facts from '../../services/localMemoryService'
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false,getPlatform:()=> 'web'},registerPlugin:()=>({})}))
const passphrase='synthetic-memory-auth-key'
const credentials=(email:string)=>({displayName:'Synthetic',email,identifier:email,anthropicKey:passphrase})
async function seed(method:'google'|'email',email:string,content:string){
  const owner=await users.generateUserId(method,email)
  users.setActiveSession({userId:owner,authMethod:method,displayName:'Synthetic',email,createdAt:1});await crypt.initCrypto(passphrase)
  scoped.setJSON('api-keys',{anthropic:passphrase});await facts.addFact(content)
  return owner
}
beforeEach(async()=>{await resetCalendarFixture();users.clearActiveSession();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external HTTP forbidden')}))})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('auth hydration with actual session, crypto and memory; no provider sign-in',()=>{
  it.each(['google','email'] as const)('publishes %s only after known membership allows memory hydration',async method=>{
    const email=`${method}@example.invalid`,owner=await seed(method,email,'Historical synthetic fact'),raw=scoped.getItem('local-memory-facts')
    users.clearActiveSession();users.removeKnownSession(owner)
    const h=renderHook(()=>useAuth())
    await act(async()=>{await h.result.current.login(method,credentials(email))})
    expect(h.result.current.currentUser?.userId).toBe(owner)
    await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    expect(facts.getAll().map(f=>f.content)).toEqual(['Historical synthetic fact']);expect(scoped.getItem('local-memory-facts')).toBe(raw)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a valid sign-in usable when memory ciphertext is corrupt, without erasing it',async()=>{
    const email='locked@example.invalid',owner=await seed('email',email,'Old fact')
    scoped.setItem('local-memory-facts','v2:corrupt');users.clearActiveSession();users.removeKnownSession(owner)
    const h=renderHook(()=>useAuth())
    await act(async()=>{await h.result.current.login('email',credentials(email))})
    expect(h.result.current.currentUser?.userId).toBe(owner)
    expect(facts.getLocalMemorySnapshot().status).toBe('unavailable');expect(scoped.getItem('local-memory-facts')).toBe('v2:corrupt')
  })
  it('hydrates B on an actual useAuth switch without exposing A in the new memory snapshot',async()=>{
    const b=await seed('email','b-memory@example.invalid','B ONLY'),a=await seed('email','a-memory@example.invalid','A ONLY')
    const h=renderHook(()=>useAuth());await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    expect(h.result.current.currentUser?.userId).toBe(a)
    await act(async()=>{await h.result.current.switchAccount(b)})
    expect(h.result.current.currentUser?.userId).toBe(b);expect(facts.getAll().map(f=>f.content)).toEqual(['B ONLY'])
  })
})
