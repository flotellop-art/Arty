import { useState } from 'react'

interface ApiKeyLoginTabProps {
  onLogin: (anthropicKey: string, geminiKey?: string) => void
  loading: boolean
}

export function ApiKeyLoginTab({ onLogin, loading }: ApiKeyLoginTabProps) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = anthropicKey.trim()
    if (!trimmed) {
      setError('La clé API Anthropic est obligatoire')
      return
    }
    if (!trimmed.startsWith('sk-ant-')) {
      setError('La clé doit commencer par sk-ant-')
      return
    }
    setError('')
    onLogin(trimmed, geminiKey.trim() || undefined)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Clé API Anthropic *
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
          Clé API Gemini <span className="text-gray-400">(optionnel)</span>
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

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading || !anthropicKey.trim()}
        className="w-full py-2.5 rounded-xl bg-bubble-user text-cream font-medium text-sm hover:bg-gray-700 transition-colors disabled:opacity-40"
      >
        {loading ? 'Connexion...' : 'Commencer'}
      </button>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Ta clé n'est jamais envoyée à nos serveurs. Elle sert uniquement à communiquer avec l'API Anthropic.
      </p>
    </form>
  )
}
