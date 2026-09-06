import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ start: vi.fn(), navigate: vi.fn(), guard: vi.fn(), accessError: null as string | null, demo: false }))
vi.mock('../../services/projects/store', () => ({ captureLocalReadScope: () => {
  fixture.guard(); return { owner: 'a', epoch: 1, assertCurrent: fixture.guard }
} })) // no list/get project available: manual form must not read one
vi.mock('../../services/userSession', () => ({ getActiveSession: () => ({ authMethod: fixture.demo ? 'demo' : 'apikey' }) }))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => ({ refresh: vi.fn(), loading: false }) }))
vi.mock('../../services/workflows/projectSynthesisAccess', () => ({ projectSynthesisAccess: (_: unknown, eu: boolean) => ({ provider: eu ? 'mistral' : 'anthropic', error: fixture.accessError }) }))
import i18n from '../../i18n'
import { useClientReply } from '../../hooks/useClientReply'
import { useProjectReview } from '../../hooks/useProjectReview'
import { ProjectReviewDialog } from '../../components/chat/ProjectReviewDialog'
import { ClientReplyScreen } from '../../screens/clientReply'
import { clientReplyQuestion } from '../../services/workflows/clientReply'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import { ProjectError } from '../../services/projects/types'
function Harness() {
  const review = useProjectReview(), [visible, setVisible] = useState(true)
  const controller = useClientReply(fixture.start, review.review, fixture.navigate)
  return <>
    {visible ? <ClientReplyScreen controller={controller} error={null} onBack={() => setVisible(false)} onAccess={() => setVisible(false)} onChat={fixture.navigate} />
      : <button onClick={() => setVisible(true)}>Resume</button>}
    {review.request && <ProjectReviewDialog key={review.request.reviewId} request={review.request} onAnswer={value => review.answer(review.request!.reviewId, value)} />}
    <button onClick={() => controller.update({ objective: 'Nouvel objectif' })}>External edit</button>
  </>
}
beforeEach(async () => {
  vi.clearAllMocks(); fixture.guard.mockReset(); fixture.accessError = null; fixture.demo = false; await i18n.changeLanguage('fr')
  fixture.start.mockImplementation(async args => {
    args.assertDraft(); args.assertAccess()
    const confirmed = await args.review({ kind: 'confirm', context: null, provider: args.euOnly ? 'mistral' : 'claude', question: clientReplyQuestion(args.fields, args.locale),
      textChars: 100, binaryBytes: 0, historyMessages: 0, files: [], systemPrompt: 'READ ONLY', clientReply: args.fields }, args.signal)
    if (confirmed !== true) return false
    args.onAdopted('adopted-chat'); return true
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function filled() {
  render(<Harness />)
  fireEvent.change(await screen.findByLabelText('Demande du client'), { target: { value: 'Demande exacte\n https://hostile.invalid' } })
  fireEvent.change(screen.getByLabelText('Faits autorisés pour la réponse'), { target: { value: 'Fait exact : 88 m².' } })
  fireEvent.change(screen.getByLabelText('Objectif de la réponse'), { target: { value: 'Objectif exact à conserver.' } })
}
const submit = () => screen.getByRole('button', { name: 'Relire avant l’appel IA' })
describe('client reply form, real controller/review, manual inputs only', () => {
  it('cancel preserves all fields/provider, next review stays exact and localized', async () => {
    await filled(); const user = userEvent.setup()
    fireEvent.change(screen.getByLabelText('Ton'), { target: { value: 'firm' } })
    fireEvent.change(screen.getByLabelText('Destinataire IA'), { target: { value: 'mistral' } })
    await user.click(submit())
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Mistral (EU)'); expect(dialog).toHaveTextContent('Ferme et courtois')
    expect(dialog).toHaveTextContent('aucun historique'); expect(dialog).toHaveTextContent('pas au client')
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Demande du client')).toHaveValue('Demande exacte\n https://hostile.invalid')
    expect(screen.getByLabelText('Faits autorisés pour la réponse')).toHaveValue('Fait exact : 88 m².')
    expect(screen.getByLabelText('Ton')).toHaveValue('firm'); expect(screen.getByLabelText('Destinataire IA')).toHaveValue('mistral')
    expect(fixture.navigate).not.toHaveBeenCalled()
    await user.click(submit()); await user.click(await screen.findByRole('button', { name: 'Confirmer l’appel IA' }))
    await waitFor(() => expect(fixture.navigate).toHaveBeenCalledOnce())
  })
  it.each(['Demande du client', 'Faits autorisés pour la réponse', 'Objectif de la réponse'])('preserves too-long %s with no entitlement misdirection', async name => {
    await filled(); const text = 'Texte intact '.repeat(800)
    fireEvent.change(screen.getByLabelText(name), { target: { value: text } })
    expect(screen.getByLabelText(name)).toHaveValue(text); expect(submit()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('n’a pas été tronqué')
    expect(screen.queryByRole('button', { name: 'Résoudre l’accès' })).not.toBeInTheDocument()
    expect(fixture.start).not.toHaveBeenCalled()
  })
  it('requires facts or explicit absence, never auto-submits', async () => {
    await filled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Faits autorisés pour la réponse'), { target: { value: '' } })
    expect(submit()).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox')); expect(submit()).toBeEnabled()
    expect(fixture.start).not.toHaveBeenCalled(); fireEvent.click(submit())
    expect(await screen.findByRole('dialog')).toHaveTextContent('Aucun fait complémentaire déclaré.')
    expect(fixture.start.mock.calls[0]?.[0].fields.noAdditionalFacts).toBe(true)
  })
  it('double submit freezes fields and shares one focus-trapped confirmation', async () => {
    await filled(); const user = userEvent.setup()
    fireEvent.click(submit()); fireEvent.click(submit())
    await screen.findByRole('dialog'); expect(fixture.start).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Demande du client')).toBeDisabled()
    await user.keyboard('{Control>}k{/Control}{Tab}')
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer l’appel IA' }))
    await waitFor(() => expect(fixture.navigate).toHaveBeenCalledOnce())
  })
  it('editing invalidates an obsolete review and requires a fresh one', async () => {
    await filled(); fireEvent.click(submit()); const dialog = await screen.findByRole('dialog')
    const staleButton = within(dialog).getByRole('button', { name: 'Confirmer l’appel IA' })
    fireEvent.click(screen.getByRole('button', { name: 'External edit' })); fireEvent.click(staleButton)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fixture.navigate).not.toHaveBeenCalled(); expect(screen.getByLabelText('Objectif de la réponse')).toHaveValue('Nouvel objectif')
    fireEvent.click(submit()); expect(await screen.findByRole('dialog')).toHaveTextContent('Nouvel objectif')
  })
  it('quota/access round-trip and Back preserve RAM inputs without sending', async () => {
    await filled(); fixture.accessError = 'compare.access.plan'
    fireEvent.change(screen.getByLabelText('Ton'), { target: { value: 'warm' } })
    expect(submit()).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Résoudre l’accès' }))
    fixture.accessError = null; fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByLabelText('Objectif de la réponse')).toHaveValue('Objectif exact à conserver.')
    expect(screen.getByLabelText('Ton')).toHaveValue('warm'); expect(submit()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retour' })); fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByLabelText('Demande du client')).toHaveValue('Demande exacte\n https://hostile.invalid'); expect(fixture.start).not.toHaveBeenCalled()
  })
  it('owner invalidation clears private fields and dismisses review', async () => {
    await filled(); fireEvent.click(submit()); await screen.findByRole('dialog')
    fixture.guard.mockImplementation(() => { throw new ProjectError('cancelled') }); act(() => invalidateLocalDataViews())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('Objectif exact à conserver.')).not.toBeInTheDocument(); expect(fixture.navigate).not.toHaveBeenCalled()
  })
  it('a real account can explicitly retry after its local scope becomes ready', async () => {
    fixture.guard.mockImplementation(() => { throw new ProjectError('locked') }); render(<Harness />)
    const retry = await screen.findByRole('button', { name: 'Réessayer' })
    fixture.guard.mockReset(); fireEvent.click(retry)
    expect(await screen.findByLabelText('Demande du client')).toHaveValue(''); expect(fixture.start).not.toHaveBeenCalled()
  })
  it('demo explains the restriction without creating a crypto/session workaround', async () => {
    fixture.demo = true; fixture.guard.mockImplementation(() => { throw new ProjectError('locked') }); render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('indisponible en démo')
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument(); expect(fixture.start).not.toHaveBeenCalled()
  })
})
