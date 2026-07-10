import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'
import './i18n' // initialise react-i18next (détection navigator + localStorage)

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
  // Track the actual visible viewport via the standard `visualViewport` API,
  // which gives CSS pixels directly (unlike the Capacitor Keyboard plugin's
  // `info.keyboardHeight` that returns device pixels — on a DPR=3 phone,
  // setting `--kb-height: 1080px` for a 1080 device-px keyboard would
  // oversubtract from `100dvh` (927 CSS px on the same phone) and collapse
  // the App root to 0).
  //
  // We expose two CSS vars on <html>:
  //   --viewport-h → visible viewport height in CSS px (App root uses this)
  //   --kb-height  → difference with the layout viewport (modals `fixed
  //                  inset-0` use this as padding-bottom to push content
  //                  above the keyboard; `fixed` still spans the layout
  //                  viewport, so subtracting from `100dvh` alone is not
  //                  enough for fixed overlays).
  const root = document.documentElement
  const updateViewport = () => {
    const vv = window.visualViewport
    const visualH = vv?.height ?? window.innerHeight
    const layoutH = root.clientHeight
    const kbHeight = Math.max(0, layoutH - visualH)
    root.style.setProperty('--viewport-h', `${visualH}px`)
    root.style.setProperty('--kb-height', `${kbHeight}px`)
  }
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  updateViewport()

  // Capacitor Keyboard plugin — explicit show/hide events let us set a CSS
  // var (`--keyboard-height`) consumed by `.keyboard-aware` containers (see
  // index.css). This is more reliable than `visualViewport` on some Android
  // ROMs where the resize event fires too late. We also hide the iOS-style
  // accessory bar (no value on Android, harmless when missing).
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {})
    Keyboard.addListener('keyboardWillShow', (info) => {
      // info.keyboardHeight on Android is in device px. Convert to CSS px
      // by dividing by devicePixelRatio so it matches `--viewport-h` (CSS
      // px). On iOS the value is already in CSS px and DPR is typically
      // ~2/3 — the same conversion gives a slightly smaller value but
      // .keyboard-aware uses it as padding-bottom which is forgiving.
      const dpr = window.devicePixelRatio || 1
      const cssPx = Math.round(info.keyboardHeight / dpr)
      root.style.setProperty('--keyboard-height', `${cssPx}px`)
    })
    Keyboard.addListener('keyboardWillHide', () => {
      root.style.setProperty('--keyboard-height', '0px')
    })
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
