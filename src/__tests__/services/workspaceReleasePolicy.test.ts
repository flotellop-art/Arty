import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, it } from 'vitest'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_RESTORE_START_ENABLED } from '../../services/workspaceWriter/activation'
import { seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'
import { readWorkspaceStorageLayout } from '../../services/workspaceWriter/control'
import { createWorkspaceAdmission } from '../../services/workspaceWriter/admission'

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear() })
it('the actual release commits to isolated readers/recovery and enables initial Web work without a storage override', async () => {
  expect(ISOLATED_WORKSPACE_ENABLED).toBe(true); expect(WORKSPACE_RESTORE_START_ENABLED).toBe(true)
  const layout = await seedIsolatedWorkspace()
  localStorage.setItem('ISOLATED_WORKSPACE_ENABLED', 'false'); localStorage.setItem('WORKSPACE_RESTORE_START_ENABLED', 'false')
  const admission = createWorkspaceAdmission({ assertLock() {}, signal: new AbortController().signal }, readWorkspaceStorageLayout)
  expect(await admission.admit()).toBe('ready'); expect(admission.getLayout()).toEqual(layout)
})
