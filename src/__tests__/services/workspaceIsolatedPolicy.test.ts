import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, it, vi } from 'vitest'
import { readWorkspaceStorageLayout } from '../../services/workspaceWriter/control'
import { createWorkspaceAdmission } from '../../services/workspaceWriter/admission'
import { isolatedWorkspaceLayout, workspaceDataKey } from '../../services/workspaceWriter/layout'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'
import { GENERATION, seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear() })
it('the actual release policy refuses a fully valid isolated fixture, without reading private data or allowing private import', async () => {
  expect(ISOLATED_WORKSPACE_ENABLED).toBe(false)
  await seedIsolatedWorkspace()
  const privateImport = vi.fn(), read = vi.spyOn(Storage.prototype, 'getItem'), write = vi.spyOn(Storage.prototype, 'setItem')
  const admission = createWorkspaceAdmission({ assertLock() {}, signal: new AbortController().signal }, readWorkspaceStorageLayout)
  if (await admission.admit() === 'ready') privateImport()
  expect(admission.getSnapshot()).toBe('incompatible'); expect(() => admission.getLayout()).toThrow()
  expect(privateImport).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  read.mockRestore(); write.mockRestore()
})
it('addresses preserve exact owner strings and distinguish null from anon; the entire descriptor is immutable', () => {
  const owners = [null, 'anon', 'a-b', 'a', 'a:[]"'], layout = isolatedWorkspaceLayout(GENERATION, owners)
  expect(new Set(owners.map(o => workspaceDataKey(layout, o, 'conversations'))).size).toBe(owners.length)
  expect(workspaceDataKey(layout, 'a', 'crypto-salt')).not.toBe(workspaceDataKey(layout, 'a', 'conversations'))
  for (const part of [layout, layout.files, layout.projects, layout.requiredOwners]) expect(Object.isFrozen(part)).toBe(true)
  owners.push('late'); expect(layout.requiredOwners).not.toContain('late')
})
it.each(['UPPERCASE', '../evil', '', '76BA201A-547F-44A1-9000-111111111111'])('rejects noncanonical generation %s', generation => {
  expect(() => isolatedWorkspaceLayout(generation, [])).toThrow('workspace_layout_invalid')
})
it('rejects holes, duplicates, extra fields and accessors without calling their code', () => {
  const getter = vi.fn(() => 'a'), accessor = ['a']
  Object.defineProperty(accessor, '0', { get: getter, enumerable: true })
  for (const owners of [new Array(1), ['a', 'a'], [null, null], [''], ['a'.repeat(129)], Object.assign(['a'], { extra: true }), accessor]) {
    expect(() => isolatedWorkspaceLayout(GENERATION, owners)).toThrow('workspace_layout_invalid')
  }
  expect(getter).not.toHaveBeenCalled()
})
