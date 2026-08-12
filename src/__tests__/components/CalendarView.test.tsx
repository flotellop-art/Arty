import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../../components/google/CalendarView'
import type { CalendarEvent } from '../../types/google'

vi.mock('../../services/calendarClient', () => ({
  listEvents: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}))

import { deleteEvent, listEvents, updateEvent } from '../../services/calendarClient'

const mockList = vi.mocked(listEvents)
const mockUpdate = vi.mocked(updateEvent)
const mockDelete = vi.mocked(deleteEvent)

const sourceEvent: CalendarEvent = {
  id: 'opaque-google-id',
  title: 'Arty OAuth Review Source Event',
  start: '2026-08-13T09:00:00+02:00',
  end: '2026-08-13T09:30:00+02:00',
  location: '',
  description: '',
  htmlLink: 'https://calendar.google.com/event?eid=review',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue([sourceEvent])
  mockUpdate.mockResolvedValue({ success: true, title: 'Updated' })
  mockDelete.mockResolvedValue({ success: true })
})

afterEach(() => vi.restoreAllMocks())

describe('CalendarView — mutations explicites', () => {
  it('rend des commandes sœurs accessibles sans bouton imbriqué', async () => {
    const { container } = render(<CalendarView onEventClick={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /Ouvrir .* Google Agenda/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Modifier Arty OAuth/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Supprimer Arty OAuth/i })).toBeInTheDocument()
    expect(container.querySelector('button button')).toBeNull()
  })

  it('modifie uniquement le titre avec l’identifiant opaque puis relit Google', async () => {
    const onEventsChange = vi.fn()
    mockList
      .mockResolvedValueOnce([sourceEvent])
      .mockResolvedValueOnce([{ ...sourceEvent, title: 'Updated source event' }])
    render(<CalendarView onEventsChange={onEventsChange} />)

    fireEvent.click(await screen.findByRole('button', { name: /Modifier Arty OAuth/i }))
    const input = screen.getByRole('textbox', { name: /Titre de l’événement/i })
    fireEvent.change(input, { target: { value: '  Updated source event  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('opaque-google-id', { title: 'Updated source event' }))
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Événement modifié dans Google Agenda.')).toHaveAttribute('role', 'status')
  })

  it('ne supprime rien si la confirmation est refusée', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CalendarView />)

    fireEvent.click(await screen.findByRole('button', { name: /Supprimer Arty OAuth/i }))

    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('confirme avec titre/date, supprime l’ID exact et retire immédiatement la ligne', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockList.mockResolvedValueOnce([sourceEvent]).mockResolvedValueOnce([])
    render(<CalendarView />)

    fireEvent.click(await screen.findByRole('button', { name: /Supprimer Arty OAuth/i }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('opaque-google-id'))
    expect(confirm.mock.calls[0]![0]).toMatch(/Arty OAuth Review Source Event/)
    expect(await screen.findByText('Événement supprimé de Google Agenda.')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('Arty OAuth Review Source Event')).not.toBeInTheDocument()
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('bloque le double clic et garde l’événement si Google refuse la suppression', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let rejectDelete!: (error: Error) => void
    mockDelete.mockImplementation(() => new Promise((_resolve, reject) => { rejectDelete = reject }))
    render(<CalendarView />)

    const deleteButton = await screen.findByRole('button', { name: /Supprimer Arty OAuth/i })
    fireEvent.click(deleteButton)
    fireEvent.click(deleteButton)
    expect(mockDelete).toHaveBeenCalledTimes(1)

    await act(async () => rejectDelete(new Error('403')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Rien n’a changé')
    expect(screen.getByText('Arty OAuth Review Source Event')).toBeInTheDocument()
    expect(deleteButton).toBeEnabled()
  })

  it('ignore une liste initiale périmée après une mutation', async () => {
    let resolveStale!: (events: CalendarEvent[]) => void
    mockList.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve }))
    const { unmount } = render(<CalendarView />)

    unmount()
    await act(async () => resolveStale([sourceEvent]))
    expect(screen.queryByText(sourceEvent.title)).not.toBeInTheDocument()
  })

  it('garde la suppression visible si la relecture Google échoue après le commit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockList.mockResolvedValueOnce([sourceEvent]).mockRejectedValueOnce(new Error('network'))
    render(<CalendarView />)

    fireEvent.click(await screen.findByRole('button', { name: /Supprimer Arty OAuth/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('agenda n’a pas pu être actualisé')
    expect(screen.queryByText(sourceEvent.title)).not.toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledOnce()
  })
})
