import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ColdErasureRecovery from '../../components/workspace/ColdErasureRecovery'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true }))
const state = vi.hoisted(() => ({ resume: vi.fn(), create: vi.fn() }))
vi.mock('../../services/workspaceWriter/erasure', () => ({ createColdWorkspaceErasure: () => { state.create(); return { resume: state.resume } } }))
const key = (s: string) => `workspaceAdmission.erasureRecovery.${s}`
beforeEach(() => { state.resume.mockReset(); state.create.mockReset() })
afterEach(cleanup)
it.each(['uncertain', 'not-sent'] as const)('%s local choice needs separate confirmation and keeps a truthful local retry after failure', async mode => {
  state.resume.mockRejectedValueOnce(new Error('failure')).mockResolvedValueOnce({})
  render(<ColdErasureRecovery mode={mode} />)
  expect(state.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(key('localOnly')))
  expect(state.resume).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent(key('localWarning'))
  fireEvent.click(screen.getByText(key('back'))); expect(state.resume).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(key('localOnly'))); fireEvent.click(screen.getByText(key('confirmLocal')))
  await screen.findByText(key('failed')); expect(state.resume).toHaveBeenLastCalledWith('local-only')
  expect(screen.queryByText(key('verify'))).toBeNull(); expect(screen.queryByText(key('cancelNotSent'))).toBeNull()
  fireEvent.click(screen.getByText(key('resume')))
  await screen.findByText(key('done')); expect(state.create).toHaveBeenCalledOnce(); expect(state.resume).toHaveBeenLastCalledWith('local-only')
})
it('unknown remote proof can only retry consultation or require separate local consent', async () => {
  state.resume.mockRejectedValue(new Error('unknown'))
  render(<ColdErasureRecovery mode="uncertain" />)
  fireEvent.click(screen.getByText(key('verify'))); await screen.findByText(key('failed'))
  expect(state.resume).toHaveBeenLastCalledWith('resume'); expect(screen.getByText(key('localOnly'))).toBeInTheDocument()
  expect(screen.queryByText(key('cancelNotSent'))).toBeNull()
})
it('cancelled not-sent request shows reload without claiming cleanup', async () => {
  state.resume.mockResolvedValue({}); render(<ColdErasureRecovery mode="not-sent" />)
  fireEvent.click(screen.getByText(key('cancelNotSent'))); await screen.findByText(key('cancelled'))
  expect(state.resume).toHaveBeenLastCalledWith('cancel-not-sent'); expect(screen.queryByText(key('done'))).toBeNull()
  expect(screen.getByText('workspaceWindow.reload')).toBeInTheDocument()
})
