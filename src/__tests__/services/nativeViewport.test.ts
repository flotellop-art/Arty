import { describe, expect, it } from 'vitest'
import capacitorConfig from '../../../capacitor.config'
import { resolveNativeViewportHeight } from '../../services/native/viewport'

describe('resolveNativeViewportHeight', () => {
  it('uses visualViewport while the keyboard is hidden', () => {
    expect(resolveNativeViewportHeight({
      layoutHeight: 900,
      visualHeight: 900,
      keyboardHeight: 0,
    })).toBe(900)
  })

  it('subtracts the native IME inset exactly once', () => {
    expect(resolveNativeViewportHeight({
      layoutHeight: 900,
      visualHeight: 580,
      keyboardHeight: 320,
    })).toBe(580)
  })

  it('does not trust an already double-reduced visualViewport', () => {
    expect(resolveNativeViewportHeight({
      layoutHeight: 900,
      visualHeight: 440,
      keyboardHeight: 320,
    })).toBe(580)
  })

  it('falls back to the native inset when visualViewport does not shrink', () => {
    expect(resolveNativeViewportHeight({
      layoutHeight: 900,
      visualHeight: 900,
      keyboardHeight: 320,
    })).toBe(580)
  })

  it('keeps Capacitor from resizing the edge-to-edge Android WebView', () => {
    expect(capacitorConfig.plugins?.Keyboard?.resizeOnFullScreen).toBe(false)
  })
})
