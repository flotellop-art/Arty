import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ENABLE_RESTRICTED_GOOGLE_FEATURES } from '../../config'

const TOOLTIP_KEY = 'arty-tooltips-seen'

type TooltipId = 'dropdowns' | 'attach' | 'mic' | 'google'

function getSeenTooltips(): Set<TooltipId> {
  try {
    const raw = localStorage.getItem(TOOLTIP_KEY)
    return raw ? new Set(JSON.parse(raw) as TooltipId[]) : new Set()
  } catch {
    return new Set()
  }
}

function markTooltipSeen(id: TooltipId): void {
  const seen = getSeenTooltips()
  seen.add(id)
  localStorage.setItem(TOOLTIP_KEY, JSON.stringify([...seen]))
}

interface TooltipBubbleProps {
  text: string
  onDismiss: () => void
}

function TooltipBubble({ text, onDismiss }: TooltipBubbleProps) {
  return (
    <div
      onClick={onDismiss}
      className="absolute z-50 bg-theme-ink text-theme-bg text-xs px-3 py-2 rounded-xl shadow-lg max-w-[200px] leading-relaxed cursor-pointer animate-fade-in"
    >
      {text}
      <div className="absolute -top-1.5 left-4 w-3 h-3 bg-theme-ink rotate-45 rounded-sm" />
    </div>
  )
}

export function useTooltip(id: TooltipId): {
  isVisible: boolean
  dismiss: () => void
  TooltipComponent: React.FC
} {
  const { t, i18n } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const seen = getSeenTooltips()
    if (!seen.has(id)) {
      // Delay to let the UI render first
      const timer = setTimeout(() => setIsVisible(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [id])

  const dismiss = () => {
    setIsVisible(false)
    markTooltipSeen(id)
  }

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (!isVisible) return
    const timer = setTimeout(dismiss, 5000)
    return () => clearTimeout(timer)
  }, [isVisible])

  const TooltipComponent = () => {
    if (!isVisible) return null
    let text = t(`onboarding.tooltips.${id}`)
    if (id === 'google' && !ENABLE_RESTRICTED_GOOGLE_FEATURES) {
      const isEn = i18n.language?.startsWith('en')
      text = isEn
        ? 'Connect Google to send emails and manage calendar'
        : 'Connecte Google pour envoyer des e-mails et gérer ton agenda'
    }
    if (!text) return null
    return <TooltipBubble text={text} onDismiss={dismiss} />
  }

  return { isVisible, dismiss, TooltipComponent }
}
