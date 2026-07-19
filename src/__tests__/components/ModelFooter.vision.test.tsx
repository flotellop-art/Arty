import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelFooter } from '../../components/chat/ModelFooter'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ModelFooter — attribution Terra vision', () => {
  it('affiche Terra et analyse photo 4K dès la ligne repliée', () => {
    render(<ModelFooter model="gpt-5.6-terra" reasonCode="image_vision_openai" />)

    const trigger = screen.getByRole('button')
    expect(trigger).toHaveTextContent('GPT-5.6 Terra · chat.modelFooter.vision4k')

    fireEvent.click(trigger)
    expect(screen.getByText('chat.routeReason.image_vision_openai')).toBeInTheDocument()
  })
})
