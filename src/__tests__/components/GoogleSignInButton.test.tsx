import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GoogleSignInButton } from '../../components/auth/GoogleSignInButton'
import { GoogleConnectButton } from '../../components/google/GoogleConnectButton'
import { GoogleReconnectDialog } from '../../components/auth/GoogleReconnectDialog'

describe('GoogleSignInButton', () => {
  it('garde le G multicolore et un libellé explicite séparé du marketing', () => {
    const onClick = vi.fn()
    const { container } = render(
      <GoogleSignInButton label="Continuer avec Google" onClick={onClick} />,
    )

    const button = screen.getByRole('button', { name: 'Continuer avec Google' })
    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('fill')))
      .toEqual(['#4285F4', '#34A853', '#FBBC05', '#EA4335'])
    expect(button).toHaveClass('bg-white', 'border-[#747775]')
    expect(button).toHaveClass('h-11', 'px-3')
    expect(button).toHaveStyle({ fontFamily: '"Google Sans", Roboto, Arial, sans-serif' })
    expect(container.querySelector('svg')).toHaveAttribute('width', '18')
    expect(container.querySelector('span')).toHaveClass('ml-2.5', 'text-sm', 'font-medium', 'leading-5')
    expect(readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'))
      .toContain('family=Google+Sans:wght@500')

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('habille aussi le CTA Agenda avec le bouton Google partagé', () => {
    const { container } = render(
      <GoogleConnectButton label="Reconnecter Google" isLoading={false} onConnect={vi.fn()} />,
    )

    const button = screen.getByRole('button', { name: 'Reconnecter Google' })
    expect(button).toHaveClass('bg-white', 'border-[#747775]')
    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('fill')))
      .toEqual(['#4285F4', '#34A853', '#FBBC05', '#EA4335'])
  })

  it('ne lance la reconnexion du plan qu’après le dialogue et sa divulgation', () => {
    const onContinue = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <GoogleReconnectDialog open onContinue={onContinue} onClose={onClose} />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('login.google.disclosure')).toBeInTheDocument()
    const googleButton = screen.getByRole('button', { name: 'login.google.continue' })
    expect(googleButton).toHaveClass('bg-white', 'border-[#747775]')
    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('fill')))
      .toEqual(['#4285F4', '#34A853', '#FBBC05', '#EA4335'])

    fireEvent.click(googleButton)
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
