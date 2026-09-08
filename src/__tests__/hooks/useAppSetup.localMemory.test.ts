import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { useAppSetup } from '../../hooks/useAppSetup'
import * as facts from '../../services/localMemoryService'
import * as crypt from '../../services/crypto'
const stubs=vi.hoisted(()=>({google:{isConnected:false,user:null},drive:{fetchFiles:vi.fn()},computer:{},memory:{loadMemory:vi.fn(),getPromptContext:vi.fn(()=> '')},executor:vi.fn()}))
vi.mock('../../services/toolExecutor',()=>({createToolExecutor:()=>stubs.executor}))
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../../hooks/useGoogleAuth',()=>({useGoogleAuth:()=>stubs.google}))
vi.mock('../../hooks/useDrive',()=>({useDrive:()=>stubs.drive}))
vi.mock('../../hooks/useComputer',()=>({useComputer:()=>stubs.computer}))
vi.mock('../../hooks/useMemory',()=>({useMemory:()=>stubs.memory}))
vi.mock('../../services/mailAccounts',()=>({hasConnectedMailAccounts:()=>false,refreshMailAccounts:vi.fn(),getCachedMailAccounts:()=>[]}))
beforeEach(async()=>{await resetCalendarFixture();vi.clearAllMocks();stubs.google.isConnected=false})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function setup(){const setPrompt=vi.fn();const hook=renderHook(()=>useAppSetup({activeId:'synthetic',sendMessage:vi.fn(),setSystemPrompt:setPrompt,setToolHandler:vi.fn()}));return{hook,setPrompt,last:()=>setPrompt.mock.lastCall?.[0]}}
describe('actual prompt builder with local encrypted memory',()=>{
  it.each([false,true])('hydrates and synchronously rebuilds with the current facts (Google connected=%s)',async connected=>{
    stubs.google.isConnected=connected;await facts.addFact('Synthetic remembered A');facts.resetLocalMemoryCache()
    const h=setup();await waitFor(()=>expect(h.last()).toContain('Synthetic remembered A'))
    await act(async()=>{await facts.addFact('Synthetic remembered B')})
    h.setPrompt.mockClear();act(()=>{window.dispatchEvent(new CustomEvent('arty-rebuild-prompt',{detail:{userMessage:'Synthetic question'}}))})
    expect(stubs.memory.loadMemory).not.toHaveBeenCalled(); expect(stubs.memory.getPromptContext).not.toHaveBeenCalled();
    expect(h.setPrompt).toHaveBeenCalledOnce();expect(h.last()).toContain('Synthetic remembered A');expect(h.last()).toContain('Synthetic remembered B')
  })
  it('clears A synchronously on switch and rebuilds only after B hydration',async()=>{
    await facts.addFact('PRIVATE A FACT');const h=setup();await waitFor(()=>expect(h.last()).toContain('PRIVATE A FACT'))
    await act(async()=>{const pending=installCalendarAccount('b');expect(h.last()).toBeUndefined();await pending;await facts.bootstrapLocalMemory();await facts.addFact('B FACT')})
    expect(h.last()).toContain('B FACT');expect(h.last()).not.toContain('PRIVATE A FACT')
  })
  it('does not preserve a previously built memory prompt after crypto becomes unusable',async()=>{
    await facts.addFact('PRIVATE A FACT');const h=setup();await waitFor(()=>expect(h.last()).toContain('PRIVATE A FACT'))
    await act(async()=>{await crypt.initCrypto('wrong-key');await facts.bootstrapLocalMemory().catch(()=>{})})
    act(()=>{window.dispatchEvent(new CustomEvent('arty-rebuild-prompt'))})
    expect(h.last()).not.toContain('PRIVATE A FACT')
  })
})
