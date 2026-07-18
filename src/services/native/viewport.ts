interface NativeViewportMetrics {
  /** Layout height before the software keyboard is applied, in CSS pixels. */
  layoutHeight: number
  /** Height reported by window.visualViewport, in CSS pixels. */
  visualHeight: number
  /** Height reported by Capacitor Keyboard, already in CSS pixels. */
  keyboardHeight: number
}

/**
 * Resolve the height available to the app without applying the IME inset
 * twice. On edge-to-edge Android, visualViewport can briefly reflect a WebView
 * that Capacitor has already resized. The native keyboard inset is therefore
 * authoritative while the keyboard is visible; visualViewport remains the
 * source of truth at all other times.
 */
export function resolveNativeViewportHeight({
  layoutHeight,
  visualHeight,
  keyboardHeight,
}: NativeViewportMetrics): number {
  const safeLayoutHeight = Math.max(0, layoutHeight)
  const safeVisualHeight = Math.max(0, visualHeight)
  const safeKeyboardHeight = Math.max(0, keyboardHeight)

  if (safeKeyboardHeight === 0) return safeVisualHeight
  return Math.max(0, safeLayoutHeight - safeKeyboardHeight)
}
