import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'

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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
