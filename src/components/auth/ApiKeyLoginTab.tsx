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
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field
        label={t('login.apiKey.anthropicLabel')}
        value={anthropicKey}
        onChange={setAnthropicKey}
        placeholder="sk-ant-api03-…"
        autoFocus
      />
      <Field
        label={`${t('login.apiKey.geminiLabel')} ${t('login.apiKey.geminiHint')}`}
        value={geminiKey}
        onChange={setGeminiKey}
        placeholder="AIza…"
      />
      <Field
        label={`${t('login.apiKey.mistralLabel')} ${t('login.apiKey.mistralHint')}`}
        value={mistralKey}
        onChange={setMistralKey}
        placeholder="…"
      />
      <Field
        label={`${t('login.apiKey.openaiLabel')} ${t('login.apiKey.openaiHint')}`}
        value={openaiKey}
        onChange={setOpenaiKey}
        placeholder="sk-…"
      />

      {error && (
        <p className="font-sans text-xs text-theme-accent">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !anthropicKey.trim()}
        className="w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-[4px] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {loading ? t('login.apiKey.connecting') : `${t('login.apiKey.submit')} →`}
      </button>

      <p className="font-display italic text-[11px] text-theme-muted text-center leading-relaxed">
        {t('login.apiKey.notice')}
      </p>
    </form>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
}

function Field({ label, value, onChange, placeholder, autoFocus }: FieldProps) {
  return (
    <div>
      <label className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5">
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 font-mono text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent transition-colors"
      />
    </div>
  )
}
