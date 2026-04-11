import { useState } from 'react'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'

interface ChatTopBarProps {
  title: string
  onBack: () => void
}

export function ChatTopBar({ title, onBack }: ChatTopBarProps) {
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
      <div className="flex items-center gap-3 px-4 py-2.5">
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
      </div>

      {/* Settings bar — style + model */}
      <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto">
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

        <div className="w-px h-4 bg-gray-200 flex-shrink-0 mx-0.5" />

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
