interface ScreenshotCardProps {
  url: string
  screenshot: string
}

export function ScreenshotCard({ url, screenshot }: ScreenshotCardProps) {
  return (
    <div className="bg-theme-surface rounded-xl border border-theme-border shadow-sm overflow-hidden my-2">
      <div className="bg-theme-ink/[0.03] px-4 py-2 border-b border-theme-border flex items-center justify-between">
        <p className="text-xs text-theme-muted truncate">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-theme-accent hover:underline flex-shrink-0 ml-2"
        >
          Ouvrir
        </a>
      </div>
      <div className="p-2">
        <img
          src={screenshot}
          alt={`Capture de ${url}`}
          className="w-full rounded-lg border border-theme-border"
        />
      </div>
    </div>
  )
}
