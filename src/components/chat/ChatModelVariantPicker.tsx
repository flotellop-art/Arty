import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CHAT_MODEL_VARIANTS, CHAT_MODEL_PREFERENCE_EVENT, getChatModelPreference,
  setChatModelPreference, type VariantProvider,
} from '../../services/chatModelPreference'

export function ChatModelVariantPicker({ provider, locked }: { provider: VariantProvider; locked: boolean }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(() => getChatModelPreference(provider) ?? '')
  useEffect(() => {
    const sync = () => setSelected(getChatModelPreference(provider) ?? '')
    sync()
    window.addEventListener(CHAT_MODEL_PREFERENCE_EVENT, sync)
    return () => window.removeEventListener(CHAT_MODEL_PREFERENCE_EVENT, sync)
  }, [provider])
  return (
    <label className="mt-3 block px-3 text-xs text-theme-ink">
      <span className="mb-1.5 block">{t('chat.modelVariant.label')}</span>
      <select
        aria-label={t('chat.modelVariant.label')}
        value={selected}
        disabled={locked}
        onChange={event => setChatModelPreference(provider, event.target.value)}
        className="w-full min-h-[44px] rounded-xl border border-theme-border bg-theme-bg px-3 text-sm disabled:opacity-50"
      >
        <option value="">{t('chat.modelVariant.default')}</option>
        {CHAT_MODEL_VARIANTS[provider].map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      <span className="mt-1.5 block text-[11px] text-theme-muted">{t('chat.modelVariant.hint')}</span>
    </label>
  )
}
