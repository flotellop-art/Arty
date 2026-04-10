import { useState } from 'react'
import { StarIcon } from '../shared/StarIcon'
import type { ApiKeys } from '../../hooks/useApiKeys'

interface ApiKeySetupProps {
  onSave: (keys: ApiKeys) => Promise<void>
}

export function ApiKeySetup({ onSave }: ApiKeySetupProps) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
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

    setSaving(true)
    setError('')
    try {
      await onSave({
        anthropic: trimmed,
        gemini: geminiKey.trim() || undefined,
      })
    } catch {
      setError('Erreur lors de la sauvegarde')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <StarIcon size={36} />
          <h1 className="font-serif text-2xl font-bold text-bubble-user">Arty</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-serif text-lg font-semibold text-bubble-user mb-1">
            Configuration
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Entre ta clé API pour commencer. Elle est chiffrée et stockée uniquement sur ton appareil.
          </p>

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

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={saving || !anthropicKey.trim()}
              className="w-full py-2.5 rounded-xl bg-bubble-user text-cream font-medium text-sm hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              {saving ? 'Chiffrement...' : 'Commencer'}
            </button>
          </form>

          <p className="text-xs text-gray-400 mt-4 text-center leading-relaxed">
            Ta clé n'est jamais envoyée à nos serveurs. Elle sert uniquement à communiquer directement avec l'API Anthropic depuis ton appareil.
          </p>
        </div>
      </div>
    </div>
  )
}
