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

  // Track software keyboard height as a CSS var so the layout can subtract
  // it from the viewport. The Android windowSoftInputMode=adjustResize alone
  // was unreliable across launchers (InputBar still got pushed to the top on
  // some devices). We use the Capacitor Keyboard plugin events and set
  // `--kb-height` on <html>; the root in App.tsx consumes it via
  // `h-[calc(100dvh-var(--kb-height,0px))]`.
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    const root = document.documentElement
    Keyboard.addListener('keyboardWillShow', (info) => {
      root.style.setProperty('--kb-height', `${info.keyboardHeight}px`)
    })
    Keyboard.addListener('keyboardDidShow', (info) => {
      root.style.setProperty('--kb-height', `${info.keyboardHeight}px`)
    })
    Keyboard.addListener('keyboardWillHide', () => {
      root.style.setProperty('--kb-height', '0px')
    })
    Keyboard.addListener('keyboardDidHide', () => {
      root.style.setProperty('--kb-height', '0px')
    })
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
