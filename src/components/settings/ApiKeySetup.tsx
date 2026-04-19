import { useState, memo } from 'react'
import { StarIcon } from '../shared/StarIcon'
import { Tag, Rule } from '../shared/editorial'
import type { ApiKeys } from '../../hooks/useApiKeys'
import { testApiKey as testOpenAIKey } from '../../services/openaiClient'

interface ApiKeySetupProps {
  onSave: (keys: ApiKeys) => Promise<void>
  /** Clés existantes (édition dans le modal Settings). */
  initialKeys?: ApiKeys | null
  /** Si embarqué dans un modal parent, pas de chrome propre. */
  embedded?: boolean
}

type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'mistral'
type TestStatus = 'idle' | 'testing' | 'ok' | 'ko'

const PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
  gemini: 'AIza…',
  mistral: '…',
}

function maskKey(key: string | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 8) + '••••••••'
}

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
    try { setStatus((await onTest()) ? 'ok' : 'ko') }
    catch { setStatus('ko') }
  }

  return (
    <div>
      <label className="block text-[10px] tracking-[0.18em] uppercase font-sans font-semibold mb-1.5" style={{ color: 'var(--arty-muted)' }}>
        {label}
        {optional && <span className="ml-1.5 normal-case tracking-normal font-serif italic" style={{ color: 'var(--arty-muted)' }}>(optionnel)</span>}
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
            className="w-full pl-3 pr-9 py-2.5 text-sm font-mono focus:outline-none"
            style={{
              backgroundColor: 'var(--arty-card)',
              color: 'var(--arty-ink)',
              border: '1px solid var(--arty-line)',
              borderBottom: '1px solid var(--arty-ink)',
              borderRadius: 2,
            }}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
            style={{ color: 'var(--arty-muted)' }}
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
            className="px-3 py-2.5 text-[11px] uppercase tracking-[0.12em] font-sans font-semibold disabled:opacity-40 transition-colors"
            style={{
              backgroundColor:
                status === 'ok' ? 'var(--arty-accent)' :
                status === 'ko' ? 'var(--arty-card-hi)' :
                'var(--arty-card)',
              color:
                status === 'ok' ? 'var(--arty-bg)' :
                status === 'ko' ? 'var(--arty-accent)' :
                'var(--arty-ink)',
              border: '1px solid var(--arty-line)',
              borderRadius: 2,
            }}
          >
            {status === 'testing' ? '…' : status === 'ok' ? '✓' : status === 'ko' ? '✗' : 'Tester'}
          </button>
        )}
      </div>
      {savedMask && !value && (
        <p className="text-[11px] font-serif italic mt-1" style={{ color: 'var(--arty-muted)' }}>
          Actuel : <span className="font-mono not-italic">{savedMask}</span>
        </p>
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
    const anthropic = anthropicKey.trim() || initialKeys?.anthropic || ''
    const gemini = geminiKey.trim() || initialKeys?.gemini || undefined
    const mistral = mistralKey.trim() || initialKeys?.mistral || undefined
    const openai = openaiKey.trim() || initialKeys?.openai || undefined

    if (!anthropic) { setError('La clé API Anthropic est obligatoire'); return }
    if (!anthropic.startsWith('sk-ant-')) { setError('La clé Anthropic doit commencer par sk-ant-'); return }
    if (openai && (!openai.startsWith('sk-') || openai.length <= 20)) {
      setError('La clé OpenAI doit commencer par sk- et faire plus de 20 caractères')
      return
    }

    setSaving(true); setError('')
    try { await onSave({ anthropic, gemini, mistral, openai }) }
    catch { setError('Erreur lors de la sauvegarde'); setSaving(false) }
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
        label={editMode ? 'Anthropic' : 'Anthropic · obligatoire'}
        value={anthropicKey}
        savedMask={maskKey(initialKeys?.anthropic)}
        onChange={setAnthropicKey}
      />
      <KeyField id="openai" label="OpenAI" optional value={openaiKey} savedMask={maskKey(initialKeys?.openai)} onChange={setOpenaiKey} onTest={testOpenAI} />
      <KeyField id="gemini" label="Gemini" optional value={geminiKey} savedMask={maskKey(initialKeys?.gemini)} onChange={setGeminiKey} />
      <KeyField id="mistral" label="Mistral · EU" optional value={mistralKey} savedMask={maskKey(initialKeys?.mistral)} onChange={setMistralKey} />

      {error && (
        <p
          className="text-[13px] font-serif italic px-3 py-2"
          style={{
            color: 'var(--arty-accent)',
            backgroundColor: 'var(--arty-accent-glow)',
            borderLeft: '2px solid var(--arty-accent)',
            borderRadius: 2,
          }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || (!editMode && !anthropicKey.trim())}
        className="w-full py-3 font-display italic text-[15px] font-medium disabled:opacity-40 transition-opacity hover:opacity-90"
        style={{
          backgroundColor: 'var(--arty-ink)',
          color: 'var(--arty-bg)',
          borderRadius: 2,
          letterSpacing: '0.02em',
        }}
      >
        {saving ? 'Chiffrement…' : editMode ? 'Enregistrer →' : 'Commencer →'}
      </button>

      <p className="font-serif italic text-[11px] text-center leading-[1.55]" style={{ color: 'var(--arty-muted)' }}>
        Tes clés sont chiffrées en AES-256 et stockées uniquement sur ton appareil.
      </p>
    </form>
  )

  if (embedded) return form

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center px-6"
      style={{ backgroundColor: 'var(--arty-bg)', color: 'var(--arty-ink)' }}
    >
      <div className="w-full max-w-md">
        <div className="inline-flex items-center gap-3 justify-center w-full mb-8">
          <StarIcon size={28} />
          <span className="font-display italic text-[26px] tracking-[-0.01em]">arty</span>
        </div>

        <div
          className="p-6"
          style={{
            backgroundColor: 'var(--arty-card)',
            border: '1px solid var(--arty-line)',
            borderRadius: 4,
            boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
          }}
        >
          <Tag accent>◈ Édition privée · Vol. 1</Tag>
          <h2 className="font-display text-[30px] leading-[1.05] font-light tracking-[-0.025em] mt-2 mb-1">
            Configuration<span style={{ color: 'var(--arty-accent)' }}>.</span>
          </h2>
          <p className="font-serif italic text-[14px] leading-[1.5] mb-5" style={{ color: 'var(--arty-muted)' }}>
            Entre tes clés API pour commencer. Elles restent sur ton appareil, chiffrées.
          </p>
          <Rule className="mb-5" />
          {form}
        </div>
      </div>
    </div>
  )
}
