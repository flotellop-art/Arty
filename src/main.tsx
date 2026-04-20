import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'
import './i18n' // initialise react-i18next (détection navigator + localStorage)

// Initialize Google Sign-In on native
if (Capacitor.isNativePlatform()) {
  import('@codetrix-studio/capacitor-google-auth').then(({ GoogleAuth }) => {
    GoogleAuth.initialize({
      clientId: '794968525529-fk2k1ffpvbev4gs4ghf4gntqjroljln3.apps.googleusercontent.com',
      scopes: [
        'email', 'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/contacts',
      ],
      grantOfflineAccess: true,
    })
  }).catch(() => {})

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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
