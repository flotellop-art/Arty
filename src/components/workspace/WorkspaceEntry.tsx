import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import type { EntryRoute } from '../../services/workspaceWriter/entryRoute'
import { DocumentWorkspaceGate, WorkspaceBootFailure } from './DocumentWorkspaceGate'
import { PublicLandingFallback } from '../shared/PublicLandingFallback'
import { ErrorBoundary } from '../shared/ErrorBoundary'

const Landing = lazy(() => import('../../screens/landing').then(m => ({ default: m.LandingScreen })))
const Shared = lazy(() => import('../share/SharedConversationView').then(m => ({ default: m.SharedConversationView })))

export function WorkspaceEntry({ route }: { route: EntryRoute }) {
  if (route === 'private') return <DocumentWorkspaceGate />
  // Public CTAs perform a full navigation: the private entry then acquires
  // before its FIRST session read. Never mount useAuth in a public document.
  return <ErrorBoundary fallback={<WorkspaceBootFailure />}><Suspense fallback={<PublicLandingFallback />}>
    {route === 'landing'
      ? <Landing onStart={() => window.location.assign('/?start=1')} onLogin={() => window.location.assign('/login')} />
      : <BrowserRouter><Routes><Route path="/share/:id" element={<Shared />} /></Routes></BrowserRouter>}
  </Suspense></ErrorBoundary>
}
