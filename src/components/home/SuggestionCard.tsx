interface SuggestionCardProps {
  text: string
  onClick: () => void
}

export function SuggestionCard({ text, onClick }: SuggestionCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-accent/30 hover:shadow-md transition-all text-sm text-bubble-user font-normal leading-relaxed"
    >
      {text}
    </button>
  )
}
