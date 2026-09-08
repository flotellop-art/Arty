import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { google, installCalendarAccount, relinkCalendarGoogle, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as memory from '../../services/autoMemory'
import * as facts from '../../services/localMemoryService'
import * as scoped from '../../services/scopedStorage'
import * as trial from '../../services/trialClient'
import * as toast from '../../services/toast'
import * as crypt from '../../services/crypto'
import * as work from '../../services/conversationWork'
import type { Conversation } from '../../types'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const conversation = (): Conversation => ({ id:'memory-funding',title:'Synthetic',createdAt:1,updatedAt:1,
  messages:[1,2,3].map(n=>({ id:`m${n}`,role:'user',content:'Préférence synthétique récurrente. '.repeat(4),timestamp:n })) })
const result = (replace: unknown[] = []) => ({ add:[],replace })
beforeEach(async()=>{
  await resetCalendarFixture(); vi.spyOn(trial,'getTrialRemaining').mockReturnValue(null)
  // Exercise the real encrypted persistence, not a plaintext replacement.
  vi.spyOn(toast,'toast').mockImplementation(()=>{})
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(result())))
})
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('memory attempts retain real account and Google grant authority',()=>{
  it.each(['network','json','http'])('does not automatically resend the same prefix after %s failure',async failure=>{
    const conv=conversation(), kept=await facts.addFact('Souvenir conservé')
    vi.mocked(fetch).mockImplementation(async()=>{
      if(failure==='network') throw new Error('lost response')
      return failure==='json'?new Response('{'):Response.json({error:'unavailable'},{status:503})
    })
    await memory.maybeExtractMemory(conv); await memory.maybeExtractMemory(conv)
    expect(fetch).toHaveBeenCalledTimes(1); expect(facts.getAll()).toEqual([kept]); expect(toast.toast).not.toHaveBeenCalled()
    expect(scoped.getJSON('auto-memory-progress')).toEqual({[conv.id]:3})
    conv.messages.push(...[4,5,6].map(n=>({id:`m${n}`,role:'user' as const,content:'Autre préférence synthétique. '.repeat(5),timestamp:n})))
    await memory.maybeExtractMemory(conv); expect(fetch).toHaveBeenCalledTimes(2)
    const sent=JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(sent.transcript).not.toContain('Préférence synthétique récurrente')
  })
  it.each(['logout','relink','grant-ABA','owner-ABA','disabled','eu'])('rejects %s while its token is pending',async change=>{
    const conv=conversation(), token=deferred<string|null>(), grant=google.captureGoogleGrant()!
    vi.spyOn(google,'captureGoogleGrant').mockReturnValue({isCurrent:grant.isCurrent,getAccessToken:()=>token.promise})
    const operation=memory.maybeExtractMemory(conv)
    if(change==='logout') google.logout()
    if(change==='relink') await relinkCalendarGoogle('a')
    if(change==='grant-ABA'){await relinkCalendarGoogle('b');await relinkCalendarGoogle('a')}
    if(change==='owner-ABA'){await installCalendarAccount('b');await installCalendarAccount('a')}
    if(change==='disabled') memory.setAutoMemoryEnabled(false)
    if(change==='eu') conv.euOnly=true
    token.resolve('synthetic-a'); await operation
    expect(fetch).not.toHaveBeenCalled(); expect(facts.getAll()).toEqual([]); expect(toast.toast).not.toHaveBeenCalled()
  })
  it.each(['logout','relink','owner-ABA','disabled','eu'])('does not apply a late body after %s',async change=>{
    const conv=conversation(), body=deferred<unknown>(), read=vi.fn(()=>body.promise)
    vi.mocked(fetch).mockResolvedValue({ok:true,json:read} as unknown as Response)
    const operation=memory.maybeExtractMemory(conv); await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce())
    if(change==='logout') google.logout()
    if(change==='relink') await relinkCalendarGoogle('a')
    if(change==='owner-ABA'){await installCalendarAccount('b');await installCalendarAccount('a')}
    if(change==='disabled') memory.setAutoMemoryEnabled(false)
    if(change==='eu') conv.euOnly=true
    body.resolve({add:[{fact:'Must not be applied'}],replace:[]}); await operation
    expect(facts.getAll()).toEqual([]); expect(toast.toast).not.toHaveBeenCalled()
  })
  it('deduplicates before eviction when memory is full',async()=>{
    for(let i=0;i<80;i++) await facts.addFact(`Souvenir synthétique ${i}`)
    const before=facts.getAll()
    expect(await memory.applyExtraction({add:[{fact:before[40].content}],replace:[]},before)).toBe(0)
    expect(facts.getAll()).toEqual(before)
  })
  it('does not overwrite a manually edited fact while the extraction is pending',async()=>{
    const old=(await facts.addFact('Ancienne préférence'))!, response=deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const operation=memory.maybeExtractMemory(conversation()); await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
    await facts.updateFact(old.id,'Préférence corrigée manuellement')
    response.resolve(Response.json(result([{id:old.id,fact:'Réponse devenue périmée'}]))); await operation
    expect(facts.getAll()[0].content).toBe('Préférence corrigée manuellement'); expect(toast.toast).not.toHaveBeenCalled()
  })
  it('only replaces identities actually transmitted, without truncating stored manual facts',async()=>{
    const old=(await facts.addFact('x'.repeat(300)))!, response=deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const operation=memory.maybeExtractMemory(conversation()); await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
    response.resolve(Response.json(result([{id:old.id,fact:'Must not replace a partial fact'}]))); await operation
    expect(facts.getAll()[0].content).toBe('x'.repeat(300)); expect(toast.toast).not.toHaveBeenCalled()
  })
  it('releases an extraction cancelled during actual encryption without committing its late result',async()=>{
    const a=await facts.addFact('A'), gate=deferred<void>(),real=crypt.encrypt
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    vi.mocked(fetch).mockResolvedValue(Response.json({add:[{fact:'Late fact'}],replace:[]}))
    const pending=memory.maybeExtractMemory(conversation());await vi.waitFor(()=>expect(encryption).toHaveBeenCalledOnce())
    google.logout();await pending // must not await the suspended encryption
    expect(work.hasActiveConversationWork()).toBe(false);expect(facts.getAll()).toEqual([a])
    gate.resolve();await facts.bootstrapLocalMemory();expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([a]);expect(toast.toast).not.toHaveBeenCalled()
  })
})
