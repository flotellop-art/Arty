import { useState } from 'react'

interface EmailLoginTabProps {
  onLogin: (email: string, password: string) => void
  loading: boolean
  error?: string
}

export function EmailLoginTab({ onLogin, loading, error: externalError }: EmailLoginTabProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) { setError('Email requis'); return }
    if (!trimmedEmail.includes('@')) { setError('Email invalide'); return }
    if (password.length < 4) { setError('Mot de passe trop court (4 caractères min)'); return }
    setError('')
    onLogin(trimmedEmail, password)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemple.com"
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="email"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Mot de passe</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="current-password"
        />
      </div>

      {(error || externalError) && (
        <p className="text-sm text-red-500">{error || externalError}</p>
      )}

      <button
        type="submit"
        disabled={loading || !email.trim() || !password}
        className="w-full py-2.5 rounded-xl bg-bubble-user text-cream font-medium text-sm hover:bg-gray-700 transition-colors disabled:opacity-40"
      >
        {loading ? 'Connexion...' : 'Se connecter / S\'inscrire'}
      </button>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Ton compte est stocké sur cet appareil. Pas de serveur.
      </p>
    </form>
  )
}
