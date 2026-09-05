import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Existing service unit suites model an ALREADY admitted private document.
// They continue testing real account/epoch/crypto guards, not boot routing.
// documentWorkspacePersistence.test.ts explicitly un-mocks this module and
// exercises the real fail-closed boundary; gate/entry suites inject real locks.
vi.mock('../services/workspaceWriter/runtime', () => ({
  assertDocumentWorkspace: () => {},
  documentWorkspaceSignal: new AbortController().signal,
  guardDocumentTransaction: <T,>(tx: T) => tx,
}))
