import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectDocument } from '../../services/projects/types'
const mocks = vi.hoisted(() => ({ getProject: vi.fn(), readText: vi.fn(), assertOperation: vi.fn() }))
vi.mock('../../services/projects/store', () => ({ getProject: mocks.getProject, readProjectDocumentText: mocks.readText, assertProjectOperation: mocks.assertOperation }))
import { buildProjectContext, projectContextText } from '../../services/projects/context'
import type { ProjectOperation } from '../../services/projects/store'
const operation = { owner: 'a', assertCurrent: vi.fn() } as unknown as ProjectOperation
const descriptor = (n: number): ProjectDocument => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name: `Source${n}.txt`, originalName: `Source${n}.txt`,
  format: 'txt', revision: 1, sourceHash: `${n}`.repeat(64), sourceBytes: 100, textChars: 100, extractorVersion: 'arty-project-text-v1', createdAt: 1 })
const project: Project = { schema: 1, owner: 'a', id: '11111111-1111-4111-8111-111111111111', revision: 2,
  name: 'P', instructions: 'Réponds en français', euOnly: true, documents: [descriptor(1), descriptor(2)], createdAt: 1, updatedAt: 2 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProject.mockResolvedValue({ status: 'ready', revision: 2, project })
  mocks.readText.mockImplementation(async (_op, _project, id) => id === project.documents[0]!.id ? 'Le devis\nMontant enduit : 2400 €\nDurée : 4 jours' : 'Planning\nDébut lundi\nFin jeudi')
})
describe('project local context retrieval', () => {
  it('returns traceable exact excerpts, hashes, project revisions and extracted line numbers', async () => {
    const context = await buildProjectContext(operation, project, 'montant enduit')
    expect(context.excerpts).toHaveLength(1)
    expect(context.excerpts[0]?.reference).toMatchObject({ projectRevision: 2, sourceHash: '1'.repeat(64), startLine: 1, endLine: 3 })
    expect(context.euOnly).toBe(true)
    expect(projectContextText(context)).toContain('untrusted content')
    expect(context.promptChars).toBeGreaterThanOrEqual(projectContextText(context).length + context.instructions.length)
  })
  it('never silently falls back to the first paragraph for generic no-hit requests', async () => {
    const context = await buildProjectContext(operation, project, 'résume ces documents')
    expect(context.noHit).toBe(true); expect(context.excerpts).toEqual([])
    expect(projectContextText(context)).toContain('No matching excerpt')
  })
  it('overview requires an explicit source selection', async () => {
    await expect(buildProjectContext(operation, project, '', { mode: 'overview' })).rejects.toMatchObject({ code: 'unsupported' })
    const context = await buildProjectContext(operation, project, '', { mode: 'overview', documentIds: project.documents.map(d => d.id) })
    expect(new Set(context.excerpts.map(e => e.reference.documentId)).size).toBe(2)
    expect(context.mode).toBe('overview')
  })
  it('selected missing files fail rather than being presented as no-hit', async () => {
    await expect(buildProjectContext(operation, project, 'planning', { documentIds: ['missing'] })).rejects.toMatchObject({ code: 'deleted' })
    expect(mocks.readText).not.toHaveBeenCalled()
  })
  it('caps the assembled payload including instructions and source metadata', async () => {
    mocks.readText.mockResolvedValue(Array.from({ length: 100 }, () => `enduit ${'a'.repeat(1500)}`).join('\n'))
    const context = await buildProjectContext(operation, project, 'enduit')
    expect(context.truncated).toBe(true)
    expect(context.excerpts.length).toBeLessThanOrEqual(20)
    expect(context.promptChars).toBeLessThanOrEqual(20_000)
    expect(projectContextText(context).length + context.instructions.length).toBeLessThanOrEqual(20_000)
  })
  it('long-line chunks have explicit partial line locators, never fabricated pages', async () => {
    mocks.readText.mockResolvedValue('enduit '.repeat(1000))
    const context = await buildProjectContext(operation, project, 'enduit')
    expect(context.excerpts[0]?.reference).toMatchObject({ startLine: 1, endLine: 1, partial: true })
    expect(context.excerpts[0]?.reference).not.toHaveProperty('page')
  })
  it('source changes during preparation fail before context publication', async () => {
    mocks.getProject.mockResolvedValueOnce({ status: 'ready', revision: 2, project })
      .mockResolvedValueOnce({ status: 'ready', revision: 3, project: { ...project, revision: 3 } })
    await expect(buildProjectContext(operation, project, 'planning')).rejects.toMatchObject({ code: 'conflict' })
  })
  it('locked sources are not silently skipped or treated as empty', async () => {
    mocks.readText.mockRejectedValue(new Error('locked'))
    await expect(buildProjectContext(operation, project, 'planning')).rejects.toThrow('locked')
  })
  it('validates request budget before reading any source', async () => {
    await expect(buildProjectContext(operation, project, 'a'.repeat(2001))).rejects.toMatchObject({ code: 'limit' })
    expect(mocks.readText).not.toHaveBeenCalled()
  })
  it('finds a query term crossing a fixed long-line chunk boundary', async () => {
    mocks.readText.mockResolvedValue('a'.repeat(1797) + 'enduit' + 'b'.repeat(100))
    const context = await buildProjectContext(operation, project, 'enduit')
    expect(context.noHit).toBe(false)
    expect(context.excerpts[0]?.text).toContain('enduit')
  })
  it('matches French accents without rewriting the original evidence', async () => {
    mocks.readText.mockResolvedValue('La rénovation coûtera 2400 euros')
    const context = await buildProjectContext(operation, project, 'renovation')
    expect(context.noHit).toBe(false)
    expect(context.excerpts[0]?.text).toContain('rénovation')
  })
  it('overlaps enough UTF-16 units for a 64-code-point astral term', async () => {
    const term = '𐐀'.repeat(64)
    mocks.readText.mockResolvedValue('a'.repeat(1700) + term + 'b'.repeat(100))
    expect((await buildProjectContext(operation, project, term)).noHit).toBe(false)
  })
})
