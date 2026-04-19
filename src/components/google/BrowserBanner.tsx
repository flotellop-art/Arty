interface BrowserBannerProps {
  action: string | null
}

export function BrowserBanner({ action }: BrowserBannerProps) {
  if (!action) return null

  return (
    <div
      className="mx-4 mb-2 px-3 py-2 flex items-center gap-2 text-[12px] font-serif italic"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderLeft: '2px solid var(--arty-accent)',
        color: 'var(--arty-ink-soft)',
        borderRadius: 2,
      }}
    >
      <span
        className="animate-spin w-3 h-3 rounded-full flex-shrink-0"
        style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--arty-accent)', borderTopColor: 'transparent' }}
      />
      <span>{action}</span>
    </div>
  )
}
