interface ChatTopBarProps {
  title: string
  onBack: () => void
}

export function ChatTopBar({ title, onBack }: ChatTopBarProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 bg-cream border-b border-gray-100">
      {/* Back */}
      <button
        onClick={onBack}
        className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors"
        aria-label="Retour"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12 4L6 10L12 16" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Title */}
      <h1 className="flex-1 text-sm font-medium text-bubble-user truncate text-center">
        {title}
      </h1>

      {/* Menu */}
      <button
        className="p-2 -mr-2 rounded-lg hover:bg-black/5 transition-colors"
        aria-label="Options"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="5" r="1.5" fill="#1E1A14" />
          <circle cx="10" cy="10" r="1.5" fill="#1E1A14" />
          <circle cx="10" cy="15" r="1.5" fill="#1E1A14" />
        </svg>
      </button>
    </header>
  )
}
