import { useState } from 'react'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'

interface TopBarProps {
  onMenuToggle: () => void
  onHistoryToggle: () => void
}

export function TopBar({ onMenuToggle, onHistoryToggle }: TopBarProps) {
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const [currentModel, setCurrentModel] = useState<AIModel>(getSelectedModel)

  const handleStyleChange = (style: ResponseStyle) => {
    saveStyle(style)
    setCurrentStyle(style)
    window.dispatchEvent(new CustomEvent('style-changed', { detail: style }))
  }

  const handleModelChange = (model: AIModel) => {
    setSelectedModel(model)
    setCurrentModel(model)
  }

  return (
    <header className="bg-cream border-b border-gray-100">
      {/* Main bar */}
      <div className="flex items-center justify-between px-4 py-2.5">
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
      </div>

      {/* Settings bar — style + model */}
      <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto">
        {/* Style chips */}
        {STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleStyleChange(opt.id)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors flex-shrink-0 ${
              currentStyle === opt.id
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            <span className="text-xs">{opt.emoji}</span>
            <span>{opt.label}</span>
          </button>
        ))}

        {/* Separator */}
        <div className="w-px h-4 bg-gray-200 flex-shrink-0 mx-0.5" />

        {/* Model chips */}
        {MODEL_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleModelChange(opt.id)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors flex-shrink-0 ${
              currentModel === opt.id
                ? 'bg-bubble-user text-cream'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            <span className="text-xs">{opt.flag}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </header>
  )
}
