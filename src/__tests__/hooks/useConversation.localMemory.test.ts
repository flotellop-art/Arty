import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
import * as facts from '../../services/localMemoryService'
import * as crypt from '../../services/crypto'
import * as storage from '../../services/storage'
import * as scoped from '../../services/scopedStorage'
import { useConversation } from '../../hooks/useConversation'
import { useAppSetup } from '../../hooks/useAppSetup'
import { streamMessage } from '../../services/anthropicClient'
import { fetchPdfMarkdowns } from '../../services/pdfUrlFetch'
import i18n from '../../i18n'
const stubs=vi.hoisted(()=>({google:{isConnected:false,user:null},drive:{fetchFiles:vi.fn()},computer:{},memory:{loadMemory:vi.fn(),getPromptContext:vi.fn((message?:string)=>message?'FILTERED_SYNTHETIC_MEMORY':'FULL_SYNTHETIC_MEMORY')},executor:vi.fn()}))
vi.mock('../../services/apiBase',()=>({apiUrl:(path:string)=>path}))
vi.mock('../../services/activeApiKey',()=>({getOpenAIKey:()=>null,getGeminiKey:()=>null,getActiveApiKey:()=> 'server-provided'}))
vi.mock('../../services/anthropicClient',()=>({streamMessage:vi.fn(()=>new AbortController())}))
vi.mock('../../services/autoMemory',()=>({maybeExtractMemory:vi.fn()}))
vi.mock('../../services/pdfUrlFetch',()=>({fetchPdfMarkdowns:vi.fn(async()=>''),fetchUrlMarkdowns:vi.fn(async()=>({block:'',unreadable:[]}))}))
vi.mock('../../services/factChecker',()=>({clearSearchContext:vi.fn(),setSearchContext:vi.fn(),getFactCheckMode:()=> 'off',runFactCheckOnLatest:vi.fn()}))
vi.mock('../../services/taskService',()=>({detectSuggestedTasks:()=>[],addTask:vi.fn()}))
vi.mock('../../services/reminderService',()=>({detectReminderIntent:()=>null,createReminder:vi.fn()}))
vi.mock('../../services/router/notifyRouteOverrides',()=>({notifyRouteOverrides:vi.fn()}))
vi.mock('../../services/router/gatherRouteInput',async original=>({...await original<typeof import('../../services/router/gatherRouteInput')>(),gatherRouteInput:(ctx:object)=>({...ctx,selectedModel:'claude',availability:{claude:true,mistral:true,gemini:true,openai:true},plan:{plan:'vip',isPro:false,creditsCoverPremium:false},reflectionLevel:'auto'})}))
vi.mock('../../services/toolExecutor',()=>({createToolExecutor:()=>stubs.executor}))
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../../hooks/useGoogleAuth',()=>({useGoogleAuth:()=>stubs.google}))
vi.mock('../../hooks/useDrive',()=>({useDrive:()=>stubs.drive}))
vi.mock('../../hooks/useComputer',()=>({useComputer:()=>stubs.computer}))
vi.mock('../../hooks/useMemory',()=>({useMemory:()=>stubs.memory}))
vi.mock('../../services/mailAccounts',()=>({hasConnectedMailAccounts:()=>false,refreshMailAccounts:vi.fn(),getCachedMailAccounts:()=>[]}))
const id='synthetic-memory-chat'
const setup=()=>{const h=renderHook(()=>{const conversation=useConversation();useAppSetup(conversation);return conversation});act(()=>h.result.current.selectConversation(id));return h}
beforeEach(async()=>{
  await resetCalendarFixture();await storage.bootstrapConversationStorage()
  storage.saveConversation({id,title:'Synthetic',messages:[],createdAt:1,updatedAt:1})
  vi.clearAllMocks();stubs.google.isConnected=false
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('unexpected external HTTP')}))
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('real chat adoption and prompt preparation with actual encrypted local memory',()=>{
  it('Stop resolves the already adopted send before a suspended memory decryption finishes',async()=>{
    await facts.addFact('PRIVATE A FACT');const h=setup();await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    const gate=deferred<void>(),real=crypt.decrypt
    const read=vi.spyOn(crypt,'decrypt').mockImplementationOnce(async raw=>{const text=await real(raw);await gate.promise;return text})
    act(()=>facts.resetLocalMemoryCache())
    let outcome:unknown='pending', pending!:Promise<boolean>
    act(()=>{pending=h.result.current.sendMessage('Synthetic question for the remembered profile',id);void pending.then(v=>{outcome=v},e=>{outcome=e})})
    await waitFor(()=>expect(read).toHaveBeenCalledOnce())
    expect(storage.getConversation(id)!.messages.filter(m=>m.role==='user')).toHaveLength(1)
    act(()=>h.result.current.stopStreaming(id))
    await waitFor(()=>expect(outcome).toBe(true)) // must finish BEFORE gate.resolve
    expect(streamMessage).not.toHaveBeenCalled()
    await act(async()=>{gate.resolve();await pending})
    expect(streamMessage).not.toHaveBeenCalled();expect(storage.getConversation(id)!.messages.filter(m=>m.role==='user')).toHaveLength(1)
  })
  it('keeps the exact per-turn English/instruction/filtered-memory prompt through a later memory refresh',async()=>{
    stubs.google.isConnected=true;await i18n.changeLanguage('en');await facts.addFact('Synthetic local preference')
    // This test isolates prompt transport, not the separate legacy custom-
    // instruction encrypted-reader issue. Seed its current plain source.
    scoped.setJSON('custom-instructions','SYNTHETIC_EXPLICIT_INSTRUCTION')
    const gate=deferred<string>();vi.mocked(fetchPdfMarkdowns).mockReturnValueOnce(gate.promise)
    const h=setup();let pending!:Promise<boolean>
    act(()=>{pending=h.result.current.sendMessage('Please read https://example.invalid/synthetic.pdf',id)})
    await waitFor(()=>expect(fetchPdfMarkdowns).toHaveBeenCalledOnce())
    await act(async()=>{facts.resetLocalMemoryCache();await facts.bootstrapLocalMemory()})
    expect(stubs.memory.getPromptContext).toHaveBeenCalledWith(expect.stringContaining('synthetic.pdf'))
    await act(async()=>{gate.resolve('Synthetic PDF text');expect(await pending).toBe(true)})
    expect(streamMessage).toHaveBeenCalledOnce()
    const prompt=vi.mocked(streamMessage).mock.calls[0][4]!.systemPrompt!
    expect(prompt).toContain('SYNTHETIC_EXPLICIT_INSTRUCTION');expect(prompt).toContain('FILTERED_SYNTHETIC_MEMORY')
    expect(prompt).not.toContain('FULL_SYNTHETIC_MEMORY');expect(prompt).toContain('Synthetic local preference')
    expect(prompt).toMatch(/English|anglais/);expect(prompt).toMatch(/mail|boîte/i)
    act(()=>h.result.current.stopStreaming(id))
  })
  it('can send using the last durable snapshot while a memory edit is still encrypting',async()=>{
    await facts.addFact('Durable A');const h=setup();await waitFor(()=>expect(facts.getLocalMemorySnapshot().status).toBe('ready'))
    const gate=deferred<void>(),real=crypt.encrypt, lifetime=new AbortController()
    const encryption=vi.spyOn(crypt,'encrypt').mockImplementationOnce(async text=>{const cipher=await real(text);await gate.promise;return cipher})
    const edit=facts.addFact('Pending B',()=>{if(lifetime.signal.aborted)throw new Error('cancelled')}).then(()=>false,()=>true)
    await waitFor(()=>expect(encryption).toHaveBeenCalledOnce())
    await act(async()=>{expect(await h.result.current.sendMessage('Synthetic question for the existing preference',id)).toBe(true)})
    expect(streamMessage).toHaveBeenCalledOnce();expect(vi.mocked(streamMessage).mock.calls[0][4]!.systemPrompt).toContain('Durable A')
    expect(vi.mocked(streamMessage).mock.calls[0][4]!.systemPrompt).not.toContain('Pending B')
    lifetime.abort();await act(async()=>{gate.resolve();expect(await edit).toBe(true)})
    expect(facts.getAll().map(f=>f.content)).toEqual(['Durable A']);act(()=>h.result.current.stopStreaming(id))
  })
})
