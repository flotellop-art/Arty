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

  // Force native ADJUST_RESIZE programmatically. The capacitor.config.ts
  // value is read on plugin init but some Android ROMs/launchers reset it.
  // setResizeMode is a no-op idempotent call that guarantees the activity
  // is in ADJUST_RESIZE mode. Combined with `windowSoftInputMode="adjustResize"`
  // in AndroidManifest.xml, the WebView shrinks when the keyboard opens and
  // `100dvh` + `position: fixed inset-0` follow the available viewport.
  import('@capacitor/keyboard').then(({ Keyboard, KeyboardResize }) => {
    Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {})
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
