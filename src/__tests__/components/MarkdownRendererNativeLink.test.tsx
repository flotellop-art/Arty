import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { browserOpen } = vi.hoisted(() => ({
  browserOpen: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}))

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: browserOpen,
  },
}))

import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'

describe('MarkdownRenderer, liens Android', () => {
  beforeEach(() => {
    browserOpen.mockReset()
    browserOpen.mockResolvedValue(undefined)
  })

  it('ouvre une source http/https dans le navigateur natif Capacitor', async () => {
    render(
      <MarkdownRenderer content="[Source vérifiée](https://example.com/article)" />,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Source vérifiée' }))

    await waitFor(() => {
      expect(browserOpen).toHaveBeenCalledWith({
        url: 'https://example.com/article',
      })
    })
  })
})
