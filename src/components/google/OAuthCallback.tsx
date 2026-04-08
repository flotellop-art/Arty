import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

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

    if (error) {
      navigate('/', { replace: true })
      return
    }

    if (code) {
      onCallback(code).then(() => {
        navigate('/', { replace: true })
      })
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, onCallback, navigate])

  return (
    <div className="flex items-center justify-center h-[100dvh] bg-cream">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-sm text-gray-500">Connexion Google en cours...</p>
      </div>
    </div>
  )
}
