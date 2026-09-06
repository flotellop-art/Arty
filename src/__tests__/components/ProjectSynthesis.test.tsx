import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../services/projects/types'
const fixture = vi.hoisted(() => ({ start: vi.fn(), navigate: vi.fn(), guard: vi.fn(), accessError: null as string | null,
  project: { schema: 1, owner: 'a', id: 'p1', revision: 2, name: 'Projet synthétique', euOnly: false, instructions: '', createdAt: 1, updatedAt: 1,
    documents: [{ id: 'd1', name: 'source.txt', originalName: 'source.txt', revision: 1, sourceHash: 'a'.repeat(64), sourceBytes: 20, textChars: 20, extractorVersion: 'arty-project-text-v1', format: 'txt', createdAt: 1 }] } as Project,
}))
vi.mock('../../services/projects/store', () => ({
  captureLocalReadScope: () => ({ owner: 'a', epoch: 1, assertCurrent: fixture.guard }),
  beginProjectOperation: async () => ({ assertCurrent: fixture.guard }),
  listProjects: async () => [{ id: fixture.project.id, status: 'ready', revision: fixture.project.revision, euOnly: false, project: fixture.project }],
}))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => ({ refresh: vi.fn(), loading: false }) }))
vi.mock('../../services/workflows/projectSynthesisAccess', () => ({ projectSynthesisAccess: () => ({ provider: 'anthropic', modelId: 'claude-sonnet-5', error: fixture.accessError }) }))
import i18n from '../../i18n'
import { useProjectSynthesis } from '../../hooks/useProjectSynthesis'
import { useProjectReview } from '../../hooks/useProjectReview'
import { ProjectReviewDialog } from '../../components/chat/ProjectReviewDialog'
import { ProjectSynthesisScreen } from '../../screens/projectSynthesis'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import { ProjectError } from '../../services/projects/types'
function Harness() {
  const review = useProjectReview(), [visible, setVisible] = useState(true)
  const controller = useProjectSynthesis(fixture.start, review.review, fixture.navigate)
  return <>
    {visible ? <ProjectSynthesisScreen controller={controller} error={null} onBack={() => setVisible(false)} onProjects={() => setVisible(false)} onAccess={() => setVisible(false)} onChat={fixture.navigate} />
      : <button onClick={() => setVisible(true)}>Resume</button>}
    {review.request && <ProjectReviewDialog key={review.request.reviewId} request={review.request} onAnswer={value => review.answer(review.request!.reviewId, value)} />}
  </>
}
beforeEach(async () => {
  vi.clearAllMocks(); fixture.guard.mockReset(); fixture.accessError = null; await i18n.changeLanguage('fr')
  fixture.start.mockImplementation(async args => {
    args.assertDraft(); args.assertAccess()
    const selection = await args.review({ kind: 'select', project: fixture.project, policy: { kind: 'project-synthesis', projectId: 'p1', projectRevision: 2 } }, args.signal)
    if (!selection) return false
    const confirmed = await args.review({ kind: 'confirm', context: null, provider: 'claude', question: args.objective,
      textChars: 100, binaryBytes: 0, historyMessages: 0, files: [], systemPrompt: 'READ ONLY' }, args.signal)
    if (confirmed !== true) return false
    args.onAdopted('adopted-chat'); return true
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function filled() {
  render(<Harness />)
  await screen.findByRole('option', { name: 'Projet synthétique' })
  fireEvent.change(screen.getByLabelText('Projet documentaire'), { target: { value: 'p1' } })
  fireEvent.change(screen.getByLabelText('Objectif de la synthèse'), { target: { value: 'Objectif exact à conserver.' } })
}
describe('guided synthesis form, real review controller and focus dialog', () => {
  it.each(['select', 'confirm'] as const)('cancel %s retains objective, project and explicitly checked document for a NEW review', async stage => {
    await filled(); const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Choisir les documents et relire' }))
    const checkbox = await screen.findByRole('checkbox', { name: 'source.txt' })
    expect(checkbox).not.toBeChecked(); await user.click(checkbox)
    if (stage === 'confirm') await user.click(screen.getByRole('button', { name: 'Préparer l’aperçu' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Objectif de la synthèse')).toHaveValue('Objectif exact à conserver.')
    expect(screen.getByLabelText('Projet documentaire')).toHaveValue('p1')
    expect(fixture.navigate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Choisir les documents et relire' }))
    expect(await screen.findByRole('checkbox', { name: 'source.txt' })).toBeChecked()
    expect(screen.getByLabelText('Mode de sélection locale')).toBeDisabled()
    expect(screen.getByLabelText('Mode de sélection locale')).toHaveValue('overview')
  })
  it('preserves a too-long paste without silent truncation and refuses preparation', async () => {
    await filled(); const text = 'exact '.repeat(400)
    fireEvent.change(screen.getByLabelText('Objectif de la synthèse'), { target: { value: text } })
    expect(screen.getByLabelText('Objectif de la synthèse')).toHaveValue(text)
    expect(screen.getByRole('alert')).toHaveTextContent('n’a pas été tronqué')
    expect(screen.queryByRole('button', { name: 'Résoudre l’accès' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revérifier l’accès' })).not.toBeInTheDocument()
    // The UI and service both reject the length; text remains available to edit.
    expect(screen.getByRole('button', { name: 'Choisir les documents et relire' })).toBeDisabled()
    expect(fixture.start).not.toHaveBeenCalled()
  })
  it('Back cancels admission; resume keeps inputs and never auto-sends', async () => {
    await filled(); const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retour' }))
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByLabelText('Objectif de la synthèse')).toHaveValue('Objectif exact à conserver.')
    expect(fixture.start).not.toHaveBeenCalled()
  })
  it('double submit owns one preparation, freezes fields and traps Ctrl-K', async () => {
    await filled(); const user = userEvent.setup(), sidebar = vi.fn()
    window.addEventListener('keydown', sidebar)
    const submit = screen.getByRole('button', { name: 'Choisir les documents et relire' })
    fireEvent.click(submit); fireEvent.click(submit)
    await screen.findByRole('dialog')
    expect(fixture.start).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Objectif de la synthèse')).toBeDisabled()
    await user.keyboard('{Control>}k{/Control}')
    expect(sidebar.mock.calls.some(([event]) => event.key === 'k')).toBe(false)
    await user.keyboard('{Tab}')
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    window.removeEventListener('keydown', sidebar)
  })
  it('invalidating private data removes the old objective and cancels its review', async () => {
    await filled(); fireEvent.click(screen.getByRole('button', { name: 'Choisir les documents et relire' }))
    await screen.findByRole('dialog')
    fixture.guard.mockImplementation(() => { throw new ProjectError('cancelled') })
    act(() => invalidateLocalDataViews())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('Objectif exact à conserver.')).not.toBeInTheDocument()
    expect(fixture.navigate).not.toHaveBeenCalled()
  })
})
