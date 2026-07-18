import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { resolveNativeViewportHeight } from './services/native/viewport'
import './index.css'
import './i18n' // initialise react-i18next (détection navigator + localStorage)
import { captureAcquisition } from './services/acquisition'

// Attribution first-party pubs (utm_* dans l'URL) — AVANT le render et tout
// login, first-touch only. Voir services/acquisition.ts pour la chaîne.
captureAcquisition()

// Cleanup any legacy service worker + cache left over from pre-1.0.13 APKs
// on Capacitor native. Without this, users upgrading from 1.0.12 still have
// the old SW serving stale assets until they manually clear app data.
// BUG 45 — do NOT touch localStorage/IndexedDB/crypto (BUG 41, BUG 43).
async function cleanupLegacyServiceWorker(): Promise<void> {
  const isCapacitorNative =
    Capacitor.isNativePlatform() ||
    (location.protocol === 'https:' && location.hostname === 'localhost')
  if (!isCapacitorNative || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('arty-cache-')).map((n) => caches.delete(n))
      )
    }
  } catch {
    // best-effort — never block boot
  }
}

void cleanupLegacyServiceWorker()

// Native Google Sign-In is provided by the app-owned GoogleSignInNative
// Capacitor plugin registered in MainActivity. Do not initialize the obsolete
// @codetrix plugin here: it only supports Capacitor 6 and duplicates the native
// implementation used by every login flow.
if (Capacitor.isNativePlatform()) {
  // Track the visible viewport in CSS pixels. While the keyboard is open, the
  // Capacitor Keyboard event is authoritative: on edge-to-edge Android,
  // visualViewport can briefly report a WebView that has already been reduced
  // by the IME and applying that value again creates a blank strip.
  //
  // We expose two CSS vars on <html>:
  //   --viewport-h → visible viewport height in CSS px (App root uses this)
  //   --kb-height  → difference with the layout viewport (modals `fixed
  //                  inset-0` use this as padding-bottom to push content
  //                  above the keyboard; `fixed` still spans the layout
  //                  viewport, so subtracting from `100dvh` alone is not
  //                  enough for fixed overlays).
  const root = document.documentElement
  let nativeKeyboardHeight = 0
  let layoutHeight = Math.max(
    root.clientHeight,
    window.innerHeight,
    window.visualViewport?.height ?? 0,
  )

  const updateViewport = () => {
    const vv = window.visualViewport
    const visualH = vv?.height ?? window.innerHeight

    // With adjustNothing, clientHeight/innerHeight keep the pre-keyboard
    // layout height. Re-sample it while the IME is hidden so rotation and
    // split-screen changes are still handled.
    if (nativeKeyboardHeight === 0) {
      layoutHeight = Math.max(root.clientHeight, window.innerHeight, visualH)
    }

    const visibleH = resolveNativeViewportHeight({
      layoutHeight,
      visualHeight: visualH,
      keyboardHeight: nativeKeyboardHeight,
    })
    const kbHeight = Math.max(0, layoutHeight - visibleH)

    root.style.setProperty('--viewport-h', `${visibleH}px`)
    root.style.setProperty('--kb-height', `${kbHeight}px`)
    root.style.setProperty('--keyboard-height', `${kbHeight}px`)
  }
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  updateViewport()

  // Capacitor Keyboard supplies CSS pixels on Android and iOS. Besides feeding
  // `.keyboard-aware`, it is the fallback for ROMs where visualViewport is
  // late or does not shrink. Listen to will+did so the final IME animation
  // frame always wins.
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {})
    const onShow = (info: { keyboardHeight: number }) => {
      nativeKeyboardHeight = Math.max(0, Math.round(info.keyboardHeight))
      updateViewport()
    }
    const onHide = () => {
      nativeKeyboardHeight = 0
      updateViewport()
      requestAnimationFrame(updateViewport)
    }
    Keyboard.addListener('keyboardWillShow', onShow)
    Keyboard.addListener('keyboardDidShow', onShow)
    Keyboard.addListener('keyboardWillHide', onHide)
    Keyboard.addListener('keyboardDidHide', onHide)
  }).catch(() => {})
}

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

// Mode démo preview : pose la session factice AVANT le render (pour que
// getActiveSession() la voie au 1er mount). `__DEMO_ALLOWED__` est `false`
// figé en prod → ce bloc + l'import() dynamique sont éliminés par Vite :
// le module previewDemo n'est même pas dans le bundle de prod.
if (__DEMO_ALLOWED__) {
  import('./services/previewDemo')
    .then((m) => { m.setupPreviewDemo() })
    .catch(() => {})
    .finally(renderApp)
} else {
  renderApp()
}
