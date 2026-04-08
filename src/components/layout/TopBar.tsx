interface TopBarProps {
  onMenuToggle: () => void
  onHistoryToggle: () => void
}

export function TopBar({ onMenuToggle, onHistoryToggle }: TopBarProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-cream">
      {/* Hamburger */}
      <button
        onClick={onMenuToggle}
        className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors"
        aria-label="Menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect y="3" width="20" height="2" rx="1" fill="#1E1A14" />
          <rect y="9" width="20" height="2" rx="1" fill="#1E1A14" />
          <rect y="15" width="20" height="2" rx="1" fill="#1E1A14" />
        </svg>
      </button>

      {/* Model selector */}
      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-black/5 transition-colors">
        <span className="text-sm font-medium text-bubble-user">Sonnet 4.6</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 5L6 8L9 5" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* History */}
      <button
        onClick={onHistoryToggle}
        className="p-2 -mr-2 rounded-lg hover:bg-black/5 transition-colors"
        aria-label="Historique"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="16" rx="2" stroke="#1E1A14" strokeWidth="1.5" fill="none" />
          <line x1="6" y1="6" x2="14" y2="6" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="10" x2="14" y2="10" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="14" x2="10" y2="14" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  )
}
