// Original regression oracles: do not weaken to make the subsidy suite green.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as crypt from '../../services/crypto'
import { blockProjectOperations } from '../../services/projects/localErasureGuard'
import { applyExtraction } from '../../services/autoMemory'
import * as facts from '../../services/localMemoryService'
import * as scoped from '../../services/scopedStorage'
beforeEach(async()=>{await resetCalendarFixture()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function encrypted(){await vi.waitFor(()=>expect(scoped.getItem('local-memory-facts')).toMatch(/^v[12]:/))}
describe('real encrypted local memory durability',()=>{
  it('keeps a fact readable after the actual ciphertext replaces the JSON',async()=>{
    const first=await facts.addFact('Synthetic fact A');await encrypted()
    expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([first])
    expect(facts.getAll()).toEqual([first])
  })
  it('does not overwrite encrypted A when adding B',async()=>{
    const first=await facts.addFact('Synthetic fact A');await encrypted()
    const second=await facts.addFact('Synthetic fact B');await encrypted()
    expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([first,second])
  })
  it('reloads the ciphertext without the memory cache, preserving long manual facts',async()=>{
    const first=await facts.addFact('A'.repeat(5000)), second=await facts.addFact('B')
    const raw=scoped.getItem('local-memory-facts'); expect(raw).toMatch(/^v[12]:/)
    facts.resetLocalMemoryCache(); expect(facts.getLocalMemorySnapshot().status).toBe('idle')
    await facts.bootstrapLocalMemory()
    expect(facts.getAll()).toEqual([first,second]); expect(scoped.getItem('local-memory-facts')).toBe(raw)
  })
  it('does not let a later write overtake an earlier encryption',async()=>{
    const first=await facts.addFact('A'), gate=deferred<void>(), real=crypt.encrypt
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    const b=facts.addFact('B'), c=facts.addFact('C')
    await vi.waitFor(()=>expect(encryption).toHaveBeenCalledTimes(1))
    expect(facts.getAll()).toEqual([first]); expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([first])
    gate.resolve(); const [second,third]=await Promise.all([b,c])
    expect(encryption).toHaveBeenCalledTimes(2)
    expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([first,second,third])
  })
  it.each(['owner-ABA','erasure'] as const)('cancels queued A mutations after %s without writing B or resurrecting A',async change=>{
    const first=await facts.addFact('A'), raw=scoped.getItem('local-memory-facts'), gate=deferred<void>(), real=crypt.encrypt
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    const b=facts.addFact('B').then(()=>false,()=>true), c=facts.addFact('C').then(()=>false,()=>true)
    await vi.waitFor(()=>expect(encryption).toHaveBeenCalledOnce())
    let release=()=>{}
    if(change==='owner-ABA'){await installCalendarAccount('b');expect(scoped.getItem('local-memory-facts')).toBeNull();await installCalendarAccount('a')}
    else release=blockProjectOperations('a')
    gate.resolve(); expect(await Promise.all([b,c])).toEqual([true,true]);release()
    expect(scoped.getItem('local-memory-facts')).toBe(raw)
    facts.resetLocalMemoryCache();await facts.bootstrapLocalMemory();expect(facts.getAll()).toEqual([first])
  })
  it('preserves old bytes and cache on quota failure and permits a later retry',async()=>{
    const first=await facts.addFact('A'), raw=scoped.getItem('local-memory-facts'), real=scoped.setItem
    const store=vi.spyOn(scoped,'setItem').mockImplementation((key,value)=>{if(key==='local-memory-facts')throw new DOMException('quota','QuotaExceededError');real(key,value)})
    await expect(facts.addFact('B')).rejects.toThrow()
    expect(scoped.getItem('local-memory-facts')).toBe(raw);expect(facts.getAll()).toEqual([first])
    store.mockRestore();const second=await facts.addFact('B');expect(await scoped.secureGetJSON('local-memory-facts')).toEqual([first,second])
  })
  it.each(['v2:invalid','not json',JSON.stringify({not:'an array'}),JSON.stringify([{id:'lm-invalid',content:'fact',createdAt:'bad'}])])('does not convert unreadable storage %s into an editable empty list',async raw=>{
    scoped.setItem('local-memory-facts',raw)
    await expect(facts.bootstrapLocalMemory()).rejects.toThrow();expect(facts.getLocalMemorySnapshot().status).toBe('unavailable')
    await expect(facts.addFact('Must not overwrite')).rejects.toThrow();await expect(facts.clearLocalMemory()).rejects.toThrow()
    expect(scoped.getItem('local-memory-facts')).toBe(raw)
  })
  it('refuses a wrong crypto key and recovers with the right one without rewriting bytes',async()=>{
    const first=await facts.addFact('A'), raw=scoped.getItem('local-memory-facts')
    await crypt.initCrypto('incorrect-synthetic-key');await expect(facts.bootstrapLocalMemory()).rejects.toThrow()
    await expect(facts.addFact('Wrong-key write')).rejects.toThrow();expect(scoped.getItem('local-memory-facts')).toBe(raw)
    await crypt.initCrypto('synthetic-calendar-key');await facts.bootstrapLocalMemory();expect(facts.getAll()).toEqual([first])
  })
  it('rejects stale hydration when the exact stored ciphertext changes',async()=>{
    await facts.addFact('A');facts.resetLocalMemoryCache()
    const gate=deferred<void>(), real=crypt.decrypt, changed=await crypt.encrypt(JSON.stringify([{id:'lm-external',content:'External',createdAt:1}]))
    const read=vi.spyOn(crypt,'decrypt').mockImplementationOnce(async raw=>{const value=await real(raw);await gate.promise;return value})
    const loading=facts.bootstrapLocalMemory().then(()=>false,()=>true)
    await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());scoped.setItem('local-memory-facts',changed);gate.resolve()
    expect(await loading).toBe(true);expect(facts.getAll()).toEqual([]);expect(scoped.getItem('local-memory-facts')).toBe(changed)
    await facts.bootstrapLocalMemory();expect(facts.getAll().map(f=>f.content)).toEqual(['External'])
  })
  it('cannot mutate cached facts through public reads or snapshots',async()=>{
    const first=await facts.addFact('A');const copy=facts.getAll();copy[0].content='Tampered';copy.push({...copy[0],id:'another'})
    expect(Object.isFrozen(facts.getLocalMemorySnapshot().facts[0])).toBe(true);expect(facts.getAll()).toEqual([first])
  })
  it('commits eviction and its replacement together, with no deletion on a failed write',async()=>{
    await facts.mutateLocalMemory(all=>{for(let i=0;i<80;i++)all.push({id:`lm-${i}`,content:`Fact ${i}`,createdAt:i})})
    const before=facts.getAll(), raw=scoped.getItem('local-memory-facts'), real=scoped.setItem
    const store=vi.spyOn(scoped,'setItem').mockImplementation((key,value)=>{if(key==='local-memory-facts')throw new Error('storage unavailable');real(key,value)})
    await expect(applyExtraction({add:[{fact:'New fact'}],replace:[]},before)).rejects.toThrow()
    expect(scoped.getItem('local-memory-facts')).toBe(raw);expect(facts.getAll()).toEqual(before);expect(store).toHaveBeenCalledOnce()
    store.mockRestore();expect(await applyExtraction({add:[{fact:'New fact'}],replace:[]},before)).toBe(1)
    const after=await scoped.secureGetJSON<facts.LocalMemoryFact[]>('local-memory-facts')
    expect(after).toHaveLength(80);expect(after!.some(f=>f.id==='lm-0')).toBe(false);expect(after![79].content).toBe('New fact')
  })
  it('deeply detaches historical extra fields in reads and retained mutation drafts',async()=>{
    type Extended=facts.LocalMemoryFact & {extra:{tags:string[]}}
    const original={id:'lm-historical',content:'A',createdAt:1,extra:{tags:['original']}}
    scoped.setJSON('local-memory-facts',[original]);await facts.bootstrapLocalMemory()
    const copy=facts.getAll() as Extended[];copy[0].extra.tags.push('external mutation')
    expect(Object.isFrozen((facts.getLocalMemorySnapshot().facts[0] as Extended).extra.tags)).toBe(true)
    let retained:Extended[]=[]
    await facts.mutateLocalMemory(draft=>{retained=draft as Extended[];draft[0].content='Edited A'})
    retained[0].extra.tags.push('late draft mutation');await facts.addFact('B')
    const durable=await scoped.secureGetJSON<Extended[]>('local-memory-facts')
    expect(durable![0]).toEqual({...original,content:'Edited A'});expect((facts.getAll()[0] as Extended).extra.tags).toEqual(['original'])
  })
  it('recovers a write that committed before its acknowledgement threw, without rollback',async()=>{
    const a=await facts.addFact('A'), real=scoped.setItem
    vi.spyOn(scoped,'setItem').mockImplementationOnce((key,value)=>{real(key,value);throw new Error('lost acknowledgement')})
    await expect(facts.addFact('B')).rejects.toThrow('lost acknowledgement')
    const committed=await scoped.secureGetJSON<facts.LocalMemoryFact[]>('local-memory-facts')
    expect(committed!.map(f=>f.content)).toEqual(['A','B']);expect(committed![0]).toEqual(a)
    await facts.bootstrapLocalMemory();expect(facts.getAll()).toEqual(committed)
  })
  it('bounds an optional reader wait and keeps ciphertext intact after timeout',async()=>{
    await facts.addFact('A');const raw=scoped.getItem('local-memory-facts');facts.resetLocalMemoryCache()
    const gate=deferred<void>(),real=crypt.decrypt
    const read=vi.spyOn(crypt,'decrypt').mockImplementationOnce(async value=>{const text=await real(value);await gate.promise;return text})
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    let outcome='pending';const loading=facts.bootstrapLocalMemory().then(()=>{outcome='success'},()=>{outcome='timeout'})
    await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(5000);await loading
    expect(outcome).toBe('timeout');expect(facts.getLocalMemorySnapshot().status).toBe('unavailable');expect(scoped.getItem('local-memory-facts')).toBe(raw)
    gate.resolve();vi.useRealTimers();await vi.waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    expect(facts.getAll().map(f=>f.content)).toEqual(['A']);expect(scoped.getItem('local-memory-facts')).toBe(raw)
  })
  it('never publishes an A hydration from before an A-B-A switch',async()=>{
    const a=await facts.addFact('A');facts.resetLocalMemoryCache();const gate=deferred<void>(),real=crypt.decrypt
    const read=vi.spyOn(crypt,'decrypt').mockImplementationOnce(async value=>{const text=await real(value);await gate.promise;return text})
    const old=facts.bootstrapLocalMemory().then(()=>false,()=>true);await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce())
    await installCalendarAccount('b');await facts.addFact('B');await installCalendarAccount('a');await facts.bootstrapLocalMemory()
    gate.resolve();expect(await old).toBe(true);expect(facts.getAll()).toEqual([a])
  })
})
