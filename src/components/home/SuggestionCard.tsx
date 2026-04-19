import { memo } from 'react'

interface SuggestionCardProps {
  text: string
  onClick: () => void
}

function SuggestionCardInner({ text, onClick }: SuggestionCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 bg-theme-surface rounded-2xl shadow-sm border border-theme-border hover:border-theme-accent/30 hover:shadow-md transition-all text-sm text-theme-ink font-normal leading-relaxed"
    >
      {text}
    </button>
  )
}

export const SuggestionCard = memo(SuggestionCardInner)
