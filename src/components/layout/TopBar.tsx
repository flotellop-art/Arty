import { useState, useRef, useEffect } from 'react'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'

interface TopBarProps {
  onMenuToggle: () => void
  onHistoryToggle: () => void
}

type OpenMenu = null | 'style' | 'model'

export function TopBar({ onMenuToggle, onHistoryToggle }: TopBarProps) {
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const [currentModel, setCurrentModel] = useState<AIModel>(getSelectedModel)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleStyleChange = (style: ResponseStyle) => {
    saveStyle(style)
    setCurrentStyle(style)
    window.dispatchEvent(new CustomEvent('style-changed', { detail: style }))
    setOpenMenu(null)
  }

  const handleModelChange = (model: AIModel) => {
    setSelectedModel(model)
    setCurrentModel(model)
    setOpenMenu(null)
  }

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenu])

  const styleOption = STYLE_OPTIONS.find(o => o.id === currentStyle) ?? STYLE_OPTIONS[0]!
  const modelOption = MODEL_OPTIONS.find(o => o.id === currentModel) ?? MODEL_OPTIONS[0]!

  return (
    <header className="bg-cream border-b border-gray-100">
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

        {/* Style + Model dropdowns */}
        <div className="flex items-center gap-2" ref={menuRef}>
          {/* Style dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                openMenu === 'style' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{styleOption.emoji}</span>
              <span>{styleOption.label}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {openMenu === 'style' && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[140px]">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleStyleChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentStyle === opt.id
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                openMenu === 'model' ? 'bg-bubble-user text-cream' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{modelOption.flag}</span>
              <span>{modelOption.label}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {openMenu === 'model' && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[140px]">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-bubble-user/10 text-bubble-user font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>{opt.flag}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

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
    </header>
  )
}
