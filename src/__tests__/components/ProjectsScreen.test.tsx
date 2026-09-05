import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectSummary } from '../../services/projects/types'
const mocks = vi.hoisted(() => ({ begin: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), delete: vi.fn(),
  prepare: vi.fn(), add: vi.fn(), context: vi.fn(), current: true }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: mocks.begin, listProjects: mocks.list,
  createProject: mocks.create, updateProject: mocks.update, removeProjectDocument: mocks.remove,
  deleteProject: mocks.delete, addProjectDocument: mocks.add }))
vi.mock('../../services/projects/documentImport', () => ({ prepareProjectDocument: mocks.prepare }))
vi.mock('../../services/projects/context', () => ({ buildProjectContext: mocks.context }))
import { ProjectsScreen } from '../../screens/projects'
import { ProjectError } from '../../services/projects/types'
const project: Project = { schema: 1, owner: 'a', id: '11111111-1111-4111-8111-111111111111', revision: 1,
  name: 'Chantier', instructions: '', euOnly: true, documents: [], createdAt: 1, updatedAt: 1 }
const summary: ProjectSummary = { id: project.id, revision: 1, euOnly: true, status: 'ready', project }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks(); mocks.current = true
  mocks.begin.mockResolvedValue({ owner: 'a', epoch: 1, fence: 'f', assertCurrent() { if (!mocks.current) throw new ProjectError('cancelled') } })
  mocks.list.mockResolvedValue([summary]); mocks.create.mockResolvedValue(project)
  mocks.update.mockImplementation(async (_op, previous, changes) => ({ ...previous, ...changes, revision: previous.revision + 1 }))
  mocks.prepare.mockImplementation(async (_op, file) => ({ name: file.name }))
  mocks.add.mockImplementation(async (_op, previous) => ({ ...previous, revision: previous.revision + 1 }))
})
async function selectProject() { fireEvent.click(await screen.findByText(/Chantier/)) }
describe('document projects UI', () => {
  it('loads the local catalogue and requires explicit confirmation even for a locked project', async () => {
    mocks.list.mockResolvedValue([{ ...summary, project: undefined, status: 'locked' }])
    render(<ProjectsScreen onBack={vi.fn()} />)
    fireEvent.click(await screen.findByText(/projects.locked ·/))
    fireEvent.click(screen.getByText('projects.delete'))
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('projects.deleteWarning')
    fireEvent.click(screen.getByText('projects.confirmDelete'))
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledTimes(1))
    expect(mocks.delete.mock.calls[0]?.slice(1)).toEqual([project.id, 1])
  })
  it('saves instructions before allowing an import and never mutates the initial manifest', async () => {
    render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    fireEvent.change(screen.getByLabelText('projects.instructions'), { target: { value: 'Keep figures exact' } })
    expect(screen.getByRole('button', { name: 'projects.import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'projects.create' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /common.back/ })).toBeDisabled()
    expect(screen.getByLabelText('projects.newName')).toBeDisabled()
    fireEvent.click(screen.getByText('projects.save'))
    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    expect(mocks.update.mock.calls[0]?.[2]).toEqual({ name: 'Chantier', instructions: 'Keep figures exact' })
    expect(project.instructions).toBe('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'projects.import' })).toBeEnabled())
  })
  it('imports one selected file at a time and preserves each successful result before a later failure', async () => {
    const gate = deferred()
    mocks.prepare.mockImplementationOnce(async () => { await gate.promise; return { name: 'first.txt' } })
      .mockRejectedValueOnce(new ProjectError('unsupported'))
    render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    fireEvent.change(screen.getByLabelText('projects.import'), { target: { files: [new File(['one'], 'first.txt'), new File(['two'], 'second.txt')] } })
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    expect(mocks.add).not.toHaveBeenCalled()
    await act(async () => gate.resolve())
    await screen.findByText('projects.errors.unsupported')
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    expect(screen.getByText('projects.imported')).toBeVisible()
  })
  it('leaving during file preparation cancels before the add operation', async () => {
    const gate = deferred()
    mocks.prepare.mockImplementationOnce(async op => { await gate.promise; op.assertCurrent(); return {} })
    const { unmount } = render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    fireEvent.change(screen.getByLabelText('projects.import'), { target: { files: [new File(['one'], 'one.txt')] } })
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled())
    unmount(); await act(async () => gate.resolve())
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('cannot start a mutation after its owner guard becomes obsolete', async () => {
    render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    fireEvent.change(screen.getByLabelText('projects.name'), { target: { value: 'Renamed' } })
    mocks.current = false
    fireEvent.click(screen.getByText('projects.save'))
    await screen.findByText('projects.errors.cancelled')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('overview is disabled without explicit selected documents', async () => {
    render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    expect(screen.getByText('projects.overview')).toBeDisabled()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(screen.queryByText('projects.startChat')).toBeNull() // not wired until chat integration
  })
  it('disables a previously armed document removal when instructions become dirty', async () => {
    mocks.list.mockResolvedValue([{ ...summary, project: { ...project, documents: [{ id: 'source-1', name: 'Source', format: 'txt', sourceBytes: 100, sourceHash: 'a'.repeat(64) }] } }])
    render(<ProjectsScreen onBack={vi.fn()} />); await selectProject()
    fireEvent.click(screen.getByText('projects.removeDocument'))
    fireEvent.change(screen.getByLabelText('projects.instructions'), { target: { value: 'Unsaved instructions' } })
    expect(screen.getByText('projects.confirmDelete')).toBeDisabled()
    fireEvent.click(screen.getByText('projects.confirmDelete'))
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(screen.getByLabelText('projects.instructions')).toHaveValue('Unsaved instructions')
  })
  it('the owner-key remount used by App removes old names and instructions before B loads', async () => {
    const { rerender } = render(<ProjectsScreen key="a" onBack={vi.fn()} />); await selectProject()
    fireEvent.change(screen.getByLabelText('projects.instructions'), { target: { value: 'Private A draft' } })
    mocks.list.mockResolvedValue([])
    rerender(<ProjectsScreen key="b" onBack={vi.fn()} />)
    expect(screen.queryByText('Chantier')).toBeNull()
    expect(screen.queryByDisplayValue('Private A draft')).toBeNull()
    await screen.findByText('projects.empty')
  })
  it('recovers automatically when cold crypto initialization completes after the first attempt', async () => {
    mocks.begin.mockRejectedValueOnce(new ProjectError('unavailable'))
    render(<ProjectsScreen onBack={vi.fn()} />)
    await screen.findByText('projects.errors.unavailable')
    act(() => window.dispatchEvent(new CustomEvent('file-storage-ready')))
    await screen.findByText(/Chantier/)
    expect(mocks.begin).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('projects.errors.unavailable')).toBeNull()
  })
  it('lets the user recapture an operation after an unavailable initial attempt', async () => {
    mocks.begin.mockRejectedValueOnce(new ProjectError('unavailable'))
    render(<ProjectsScreen onBack={vi.fn()} />)
    await screen.findByText('projects.errors.unavailable')
    fireEvent.click(screen.getByText('projects.reload'))
    await screen.findByText(/Chantier/)
    expect(mocks.begin).toHaveBeenCalledTimes(2)
  })
})
