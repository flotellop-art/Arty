import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { verifyOAuthState } from '../../services/googleAuth'

interface OAuthCallbackProps {
  onCallback: (code: string) => Promise<void>
}

export function OAuthCallback({ onCallback }: OAuthCallbackProps) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state')

    if (error) {
      navigate('/', { replace: true })
      return
    }

    // CSRF: reject any callback that doesn't carry our `state` nonce.
    // verifyOAuthState() also single-use-clears the stored value to
    // prevent replay (even if the check fails).
    if (!verifyOAuthState(state)) {
      console.warn('[OAuthCallback] state mismatch — rejecting callback')
      navigate('/', { replace: true })
      return
    }

    if (code) {
      onCallback(code)
        .then(() => navigate('/', { replace: true }))
        .catch(() => navigate('/', { replace: true }))
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, onCallback, navigate])

  return (
    <div className="flex items-center justify-center h-[100dvh] bg-theme-bg">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-theme-accent border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-sm text-theme-muted">Connexion Google en cours...</p>
      </div>
    </div>
  )
}
