interface ActionBannerProps {
  icon: string
  message: string
  isVisible: boolean
}

export function ActionBanner({ icon, message, isVisible }: ActionBannerProps) {
  if (!isVisible) return null

  return (
    <div className="mx-4 mb-2 px-3 py-2 bg-theme-accent/5 border border-theme-accent/20 rounded-xl flex items-center gap-2 text-sm text-theme-accent animate-pulse">
      <span>{icon}</span>
      <span>{message}</span>
    </div>
  )
}
