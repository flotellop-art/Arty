import { useState, useEffect } from 'react'

const TOOLTIP_KEY = 'arty-tooltips-seen'

type TooltipId = 'dropdowns' | 'attach' | 'mic' | 'google'

interface TooltipDef {
  id: TooltipId
  text: string
}

const ALL_TOOLTIPS: TooltipDef[] = [
  { id: 'dropdowns', text: 'Change le ton et le modèle IA ici' },
  { id: 'attach', text: 'Envoie une photo ou un fichier' },
  { id: 'mic', text: 'Dicte ton message' },
  { id: 'google', text: 'Connecte Google pour accéder à tes mails et fichiers' },
]

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
      className="absolute z-50 bg-bubble-user text-cream text-xs px-3 py-2 rounded-xl shadow-lg max-w-[200px] leading-relaxed cursor-pointer animate-fade-in"
    >
      {text}
      <div className="absolute -top-1.5 left-4 w-3 h-3 bg-bubble-user rotate-45 rounded-sm" />
    </div>
  )
}

export function useTooltip(id: TooltipId): {
  isVisible: boolean
  dismiss: () => void
  TooltipComponent: React.FC
} {
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
    const def = ALL_TOOLTIPS.find(t => t.id === id)
    if (!def) return null
    return <TooltipBubble text={def.text} onDismiss={dismiss} />
  }

  return { isVisible, dismiss, TooltipComponent }
}
