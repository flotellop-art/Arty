import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Existing service unit suites model an ALREADY admitted private document.
// They continue testing real account/epoch/crypto guards, not boot routing.
// documentWorkspacePersistence.test.ts explicitly un-mocks this module and
// exercises the real fail-closed boundary; gate/entry suites inject real locks.
vi.mock('../services/workspaceWriter/runtime', () => ({
  assertDocumentWorkspace: () => {},
  documentStorageKey: (owner: string | null, key: string) => owner ? `arty-${owner}-${key}` : `arty-${key}`,
  getDocumentStorageLayout: () => ({ kind: 'legacy-v1', files: { name: 'arty-files', version: 1 }, projects: { name: 'arty-projects', version: 1 } }),
  documentWorkspaceSignal: new AbortController().signal,
  guardDocumentTransaction: <T,>(tx: T) => tx,
}))
