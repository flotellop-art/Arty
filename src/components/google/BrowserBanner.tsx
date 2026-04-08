interface BrowserBannerProps {
  action: string | null
}

export function BrowserBanner({ action }: BrowserBannerProps) {
  if (!action) return null

  return (
    <div className="mx-4 mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-sm text-blue-600">
      <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full flex-shrink-0" />
      <span>{action}</span>
    </div>
  )
}
