interface ActionBannerProps {
  icon: string
  message: string
  isVisible: boolean
}

export function ActionBanner({ message, isVisible }: ActionBannerProps) {
  if (!isVisible) return null

  return (
    <div
      className="mx-4 mb-2 px-3 py-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] font-sans font-semibold"
      style={{
        backgroundColor: 'var(--arty-accent-glow)',
        border: '1px solid var(--arty-accent)',
        color: 'var(--arty-accent)',
        borderRadius: 2,
      }}
    >
      <span>◈</span>
      <span>{message}…</span>
      <div className="flex-1 h-px" style={{ background: 'currentColor', opacity: 0.3 }} />
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: 'var(--arty-accent)', animation: 'pulse 1.2s infinite' }}
      />
    </div>
  )
}
