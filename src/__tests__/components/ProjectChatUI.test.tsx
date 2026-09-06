import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { ProjectReview } from '../../services/projects/chatPreparation'
const mock = vi.hoisted(() => ({ getProject: vi.fn(), list: vi.fn(), begin: vi.fn(), claude: vi.fn(), mistral: vi.fn(), owner: 'a', epoch: 1, crypto: true, mistralAvailable: true }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }) }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: mock.begin, getProject: mock.getProject, listProjects: mock.list, assertProjectOperation: async () => {} }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: mock.claude }))
vi.mock('../../services/mistralClient', () => ({ streamMistralMessage: mock.mistral }))
vi.mock('../../services/crypto', () => ({ captureCryptoGuard: () => () => mock.crypto }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mock.owner, getActiveSessionEpoch: () => mock.epoch }))
vi.mock('../../services/reportGenerator', () => ({ openReport: vi.fn() }))
vi.mock('../../components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: () => null }))
vi.mock('../../services/router/gatherRouteInput', () => ({ classifyRouteAttachments: () => ({}), gatherRouteInput: (ctx: object) => ({ ...ctx, availability: { mistral: mock.mistralAvailable } }) }))
import { ProjectReviewDialog } from '../../components/chat/ProjectReviewDialog'
import { ProjectConversationPanel } from '../../components/chat/ProjectConversationPanel'
import { ConversationSummaryModal } from '../../components/chat/ConversationSummaryModal'
import { openReport } from '../../services/reportGenerator'
const conv: Conversation = { id: 'c', title: 'Projet', projectId: 'p', hasProjectContext: true, createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'user', content: 'Échange', timestamp: 1 }] }
const confirm: ProjectReview = { kind: 'confirm', context: null, provider: 'claude', question: 'QUESTION EFFECTIVE', systemPrompt: 'SP', textChars: 32_100, binaryBytes: 0, historyMessages: 1, files: [] }
beforeEach(() => {
  vi.clearAllMocks(); mock.owner = 'a'; mock.epoch = 1; mock.crypto = true; mock.mistralAvailable = true
  mock.begin.mockResolvedValue({ assertCurrent: () => {} })
  mock.claude.mockReturnValue(new AbortController()); mock.mistral.mockReturnValue(new AbortController())
})
describe('project review UI and secondary summary route', () => {
  it('never auto-summarizes a restricted client reply even if the modal is directly mounted', () => {
    render(<ConversationSummaryModal conversation={{ ...conv, outputRestriction: 'client-reply-draft-v1' }} onClose={vi.fn()} />)
    expect(screen.getByText('summary.clientDraftUnavailable')).toBeVisible()
    expect(mock.claude).not.toHaveBeenCalled(); expect(mock.mistral).not.toHaveBeenCalled()
  })
  it('requires an explicit click and shows detached/history and effective question truthfully', () => {
    const answer = vi.fn(); render(<ProjectReviewDialog request={confirm} onAnswer={answer} />)
    expect(answer).not.toHaveBeenCalled(); expect(screen.getByText(/Bibliothèque non jointe/)).toBeVisible()
    expect(screen.getByText(/QUESTION EFFECTIVE/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Annuler, garder mon texte')); expect(answer).toHaveBeenCalledWith(null)
  })
  it('labels partial extracted lines without claiming a full document review', () => {
    const request: ProjectReview = { ...confirm, context: { projectId: 'p', projectRevision: 1, name: 'Projet', instructions: '', euOnly: false, mode: 'search', noHit: false, truncated: true, textChars: 8, promptChars: 800, examinedDocuments: 1,
      excerpts: [{ text: 'fragment', reference: { projectId: 'p', projectRevision: 1, documentId: 'd', documentRevision: 1, sourceHash: 'a'.repeat(64), extractorVersion: 'arty-project-text-v1', name: 'source.txt', format: 'txt', startLine: 4, endLine: 4, partial: true } }] } }
    const answer = vi.fn(); render(<ProjectReviewDialog request={request} onAnswer={answer} />)
    expect(screen.getByText(/ligne partielle/)).toBeVisible(); expect(screen.getByText(/Sélection partielle/)).toBeVisible()
    fireEvent.click(screen.getByText('Confirmer cet envoi')); expect(answer).toHaveBeenCalledWith(true)
  })
  it('empty no-hit requires explicit send without new excerpts', () => {
    const request: ProjectReview = { ...confirm, context: { projectId: 'p', projectRevision: 1, name: 'Projet', instructions: '', euOnly: false, mode: 'search', noHit: true, truncated: false, textChars: 0, promptChars: 300, examinedDocuments: 1, excerpts: [] } }
    const answer = vi.fn(); render(<ProjectReviewDialog request={request} onAnswer={answer} />)
    expect(screen.getByText(/Aucun extrait correspondant/)).toBeVisible()
    fireEvent.click(screen.getByText('Envoyer sans nouvel extrait')); expect(answer).toHaveBeenCalledWith(true)
  })
  it('a missing linked project remains explicitly detachable', async () => {
    mock.getProject.mockResolvedValue(null); mock.list.mockResolvedValue([])
    const change = vi.fn(async () => true); render(<ProjectConversationPanel conversation={conv} busy={false} onChange={change} />)
    await screen.findByText(/Projet indisponible/)
    fireEvent.click(screen.getByText('Association projet · gérer'))
    const select = await screen.findByLabelText('Projet de la conversation')
    expect(select).toHaveValue('p')
    fireEvent.change(select, { target: { value: '' } }); fireEvent.click(screen.getByText('Confirmer cette association'))
    await waitFor(() => expect(change).toHaveBeenCalledWith(null))
  })
  it('summary is read-only, separate from library analysis and never relays stale tokens', async () => {
    render(<ConversationSummaryModal conversation={conv} onClose={vi.fn()} />)
    expect(screen.getByText('summary.exchangesOnly')).toBeVisible()
    const call = mock.claude.mock.calls[0]!
    expect(call[4]).toMatchObject({ documentReadOnly: true, background: true })
    expect(call[4].systemPrompt).toContain('ne sont PAS relues')
    await call[4].beforeDocumentRequest()
    expect(mock.getProject).not.toHaveBeenCalled()
    mock.epoch++
    expect(() => call[4].assertRequestCurrent()).toThrow()
    act(() => call[1]('NE DOIT PAS APPARAÎTRE'))
    expect(screen.queryByText('NE DOIT PAS APPARAÎTRE')).toBeNull()
  })
  it('EU summary refuses unavailable Mistral and never falls back to Claude', () => {
    mock.mistralAvailable = false
    render(<ConversationSummaryModal conversation={{ ...conv, euOnly: true }} onClose={vi.fn()} />)
    expect(screen.getByText('errors.euPlanRequired')).toBeVisible()
    expect(mock.mistral).not.toHaveBeenCalled(); expect(mock.claude).not.toHaveBeenCalled()
  })
  it('an old completed summary cannot be exported from a newly active account before remount', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {}), popup = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ConversationSummaryModal conversation={conv} onClose={vi.fn()} />)
    const call = mock.claude.mock.calls[0]!
    act(() => { call[1]('Résumé du compte A'); call[2]() })
    mock.owner = 'b'; mock.epoch++
    fireEvent.click(screen.getByText(/summary.exportPdf/))
    await waitFor(() => expect(warning).toHaveBeenCalled())
    expect(openReport).not.toHaveBeenCalled(); expect(popup).not.toHaveBeenCalled()
    warning.mockRestore(); popup.mockRestore()
  })
})
