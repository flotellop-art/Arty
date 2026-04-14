import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ApiKeyLoginTabProps {
  onLogin: (anthropicKey: string, geminiKey?: string, mistralKey?: string, openaiKey?: string) => void
  loading: boolean
}

export function ApiKeyLoginTab({ onLogin, loading }: ApiKeyLoginTabProps) {
  const { t } = useTranslation()
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [mistralKey, setMistralKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = anthropicKey.trim()
    if (!trimmed) {
      setError(t('login.apiKey.errors.required'))
      return
    }
    if (!trimmed.startsWith('sk-ant-')) {
      setError(t('login.apiKey.errors.invalidPrefix'))
      return
    }
    setError('')
    onLogin(
      trimmed,
      geminiKey.trim() || undefined,
      mistralKey.trim() || undefined,
      openaiKey.trim() || undefined,
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          {t('login.apiKey.anthropicLabel')}
        </label>
        <input
          type="password"
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="off"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          {t('login.apiKey.geminiLabel')} <span className="text-gray-400">{t('login.apiKey.geminiHint')}</span>
        </label>
        <input
          type="password"
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          placeholder="AIza..."
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          {t('login.apiKey.mistralLabel')} <span className="text-gray-400">{t('login.apiKey.mistralHint')}</span>
        </label>
        <input
          type="password"
          value={mistralKey}
          onChange={(e) => setMistralKey(e.target.value)}
          placeholder="..."
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          {t('login.apiKey.openaiLabel')} <span className="text-gray-400">{t('login.apiKey.openaiHint')}</span>
        </label>
        <input
          type="password"
          value={openaiKey}
          onChange={(e) => setOpenaiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 bg-gray-50"
          autoComplete="off"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading || !anthropicKey.trim()}
        className="w-full py-2.5 rounded-xl bg-bubble-user text-cream font-medium text-sm hover:bg-gray-700 transition-colors disabled:opacity-40"
      >
        {loading ? t('login.apiKey.connecting') : t('login.apiKey.submit')}
      </button>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        {t('login.apiKey.notice')}
      </p>
    </form>
  )
}
