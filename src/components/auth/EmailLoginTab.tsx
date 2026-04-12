import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EmailLoginTabProps {
  onLogin: (email: string, password: string) => void
  loading: boolean
  error?: string
}

export function EmailLoginTab({ onLogin, loading, error: externalError }: EmailLoginTabProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) { setError(t('login.email.errors.required')); return }
    if (!trimmedEmail.includes('@')) { setError(t('login.email.errors.invalid')); return }
    if (password.length < 4) { setError(t('login.email.errors.passwordShort')); return }
    setError('')
    onLogin(trimmedEmail, password)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('login.email.label')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('login.email.placeholderEmail')}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="email"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('login.email.password')}</label>
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
        {loading ? t('login.email.connecting') : t('login.email.submit')}
      </button>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        {t('login.email.notice')}
      </p>
    </form>
  )
}
