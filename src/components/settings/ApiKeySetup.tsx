import { useState, memo } from 'react'
import { ArtyWordmark } from '../shared/PrismMark'
import type { ApiKeys } from '../../hooks/useApiKeys'
import { testApiKey as testOpenAIKey } from '../../services/openaiClient'

interface ApiKeySetupProps {
  onSave: (keys: ApiKeys) => Promise<void>
  /** Existing keys (for edit mode inside the Settings modal). */
  initialKeys?: ApiKeys | null
  /** When inside a modal, the parent usually provides its own chrome. */
  embedded?: boolean
}

type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'mistral'
type TestStatus = 'idle' | 'testing' | 'ok' | 'ko'

const PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  gemini: 'AIza...',
  mistral: '...',
}

function maskKey(key: string | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 8) + '••••••••'
}

// Eye icon toggling between shown / hidden
function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
      <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

interface KeyFieldProps {
  id: ProviderId
  label: string
  optional?: boolean
  value: string
  savedMask?: string
  onChange: (value: string) => void
  onTest?: () => Promise<boolean>
}

const KeyField = memo(function KeyField({ id, label, optional, value, savedMask, onChange, onTest }: KeyFieldProps) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<TestStatus>('idle')

  const handleTest = async () => {
    if (!onTest || !value.trim()) return
    setStatus('testing')
    try {
      const ok = await onTest()
      setStatus(ok ? 'ok' : 'ko')
    } catch {
      setStatus('ko')
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-theme-ink/70 mb-1.5">
        {label}
        {optional && <span className="text-theme-muted/70 ml-1">(optionnel)</span>}
      </label>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              if (status !== 'idle') setStatus('idle')
            }}
            placeholder={savedMask || PLACEHOLDERS[id]}
            className="w-full pl-3 pr-9 py-2.5 rounded-xl border border-theme-border text-sm focus:outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent/30 bg-theme-ink/[0.03] text-theme-ink"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-theme-muted/70 hover:text-theme-ink/70"
            aria-label={visible ? 'Masquer' : 'Afficher'}
          >
            <EyeIcon visible={visible} />
          </button>
        </div>
        {onTest && (
          <button
            type="button"
            onClick={handleTest}
            disabled={status === 'testing' || !value.trim()}
            className="px-3 py-2.5 rounded-xl bg-theme-ink/5 text-xs font-medium text-theme-ink/80 hover:bg-theme-ink/10 transition-colors disabled:opacity-40"
          >
            {status === 'testing' ? '...' : status === 'ok' ? '✓' : status === 'ko' ? '✗' : 'Tester'}
          </button>
        )}
      </div>
      {savedMask && !value && (
        <p className="text-xs text-theme-muted/70 mt-1">Actuel : {savedMask}</p>
      )}
    </div>
  )
})

export function ApiKeySetup({ onSave, initialKeys, embedded }: ApiKeySetupProps) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [mistralKey, setMistralKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const editMode = !!initialKeys

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // In edit mode, empty fields keep the existing key
    const anthropic = anthropicKey.trim() || initialKeys?.anthropic || ''
    const gemini = geminiKey.trim() || initialKeys?.gemini || undefined
    const mistral = mistralKey.trim() || initialKeys?.mistral || undefined
    const openai = openaiKey.trim() || initialKeys?.openai || undefined

    if (!anthropic) {
      setError('La clé API Anthropic est obligatoire')
      return
    }
    if (!anthropic.startsWith('sk-ant-')) {
      setError('La clé Anthropic doit commencer par sk-ant-')
      return
    }
    if (openai && (!openai.startsWith('sk-') || openai.length <= 20)) {
      setError('La clé OpenAI doit commencer par sk- et faire plus de 20 caractères')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({ anthropic, gemini, mistral, openai })
    } catch {
      setError('Erreur lors de la sauvegarde')
      setSaving(false)
    }
  }

  const testOpenAI = async () => {
    const key = openaiKey.trim() || initialKeys?.openai || ''
    if (!key) return false
    return testOpenAIKey(key)
  }

  const form = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <KeyField
        id="anthropic"
        label={editMode ? 'Clé API Anthropic' : 'Clé API Anthropic *'}
        value={anthropicKey}
        savedMask={maskKey(initialKeys?.anthropic)}
        onChange={setAnthropicKey}
      />

      <KeyField
        id="openai"
        label="Clé API OpenAI"
        optional
        value={openaiKey}
        savedMask={maskKey(initialKeys?.openai)}
        onChange={setOpenaiKey}
        onTest={testOpenAI}
      />

      <KeyField
        id="gemini"
        label="Clé API Gemini"
        optional
        value={geminiKey}
        savedMask={maskKey(initialKeys?.gemini)}
        onChange={setGeminiKey}
      />

      <KeyField
        id="mistral"
        label="Clé API Mistral (EU)"
        optional
        value={mistralKey}
        savedMask={maskKey(initialKeys?.mistral)}
        onChange={setMistralKey}
      />

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving || (!editMode && !anthropicKey.trim())}
        className="w-full py-2.5 rounded-xl bg-theme-ink text-theme-bg font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-40"
      >
        {saving ? 'Chiffrement...' : editMode ? 'Enregistrer' : 'Commencer'}
      </button>

      <p className="text-xs text-theme-muted/70 text-center leading-relaxed">
        Tes clés sont chiffrées en AES-256 et stockées uniquement sur ton appareil.
      </p>
    </form>
  )

  if (embedded) {
    return form
  }

  return (
    <div className="min-h-[100dvh] bg-theme-bg flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <ArtyWordmark size={28} color="rgb(var(--theme-accent))" />
        </div>

        <div className="bg-theme-surface rounded-2xl shadow-sm border border-theme-border p-6">
          <h2 className="font-display text-lg text-theme-ink mb-1">
            Configuration
          </h2>
          <p className="text-sm text-theme-muted mb-5">
            Entre tes clés API pour commencer. Elles sont chiffrées et stockées uniquement sur ton appareil.
          </p>
          {form}
        </div>
      </div>
    </div>
  )
}
