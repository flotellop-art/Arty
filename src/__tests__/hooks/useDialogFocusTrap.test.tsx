import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

function DialogHarness() {
  const [open, setOpen] = useState(false)
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, () => setOpen(false))

  return (
    <>
      <button id="arty-menu-button" type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button" autoFocus>Action initiale</button>
          <button type="button">Dernière action</button>
        </div>
      )}
    </>
  )
}

describe('useDialogFocusTrap', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('place le focus initial puis boucle Tab dans la modale', () => {
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))

    const first = screen.getByRole('button', { name: 'Action initiale' })
    const last = screen.getByRole('button', { name: 'Dernière action' })
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('ferme avec Échap et restaure le focus à l’élément déclencheur', () => {
    render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: 'Ouvrir' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
