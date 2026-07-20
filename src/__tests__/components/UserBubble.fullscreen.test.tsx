import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserBubble } from '../../components/chat/UserBubble'

const mocks = vi.hoisted(() => ({ getFile: vi.fn() }))

vi.mock('../../services/secureFileStorage', () => ({ getFile: mocks.getFile }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('UserBubble — viewer photo plein écran', () => {
  const createObjectURL = vi.fn(() => 'blob:photo-1')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    mocks.getFile.mockReset()
    mocks.getFile.mockResolvedValue({
      id: 'photo-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      data: 'AQID',
      size: 3,
    })
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('réutilise la vignette locale dans un portal sans second chargement', async () => {
    render(<UserBubble content="décris" files={[{
      id: 'photo-1', name: 'photo.jpg', type: 'image/jpeg', size: 3,
    }]} />)

    const trigger = await screen.findByRole('button', { name: /photo\.jpg.*openFullscreen/ })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'photo.jpg' })
    const fullImage = dialog.querySelector('img')
    expect(fullImage).toHaveAttribute('src', 'blob:photo-1')
    expect(fullImage).toHaveClass('object-contain')
    expect(mocks.getFile).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('ferme au clic sur le fond et révoque le Blob exactement au démontage', async () => {
    const view = render(<UserBubble content="décris" files={[{
      id: 'photo-1', name: 'photo.jpg', type: 'image/jpeg', size: 3,
    }]} />)
    fireEvent.click(await screen.findByRole('button', { name: /openFullscreen/ }))
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
  })

  it('laisse une image indisponible non cliquable', async () => {
    mocks.getFile.mockResolvedValue(null)
    render(<UserBubble content="décris" files={[{
      id: 'missing', name: 'missing.jpg', type: 'image/jpeg', size: 3,
    }]} />)

    expect(await screen.findByText('chat.userBubble.imageUnavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /openFullscreen/ })).not.toBeInTheDocument()
  })
})
