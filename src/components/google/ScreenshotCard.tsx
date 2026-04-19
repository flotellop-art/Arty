interface ScreenshotCardProps {
  url: string
  screenshot: string
}

export function ScreenshotCard({ url, screenshot }: ScreenshotCardProps) {
  return (
    <div
      className="overflow-hidden my-3"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
      }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{ backgroundColor: 'var(--arty-card-hi)', borderBottom: '1px solid var(--arty-line)' }}
      >
        <p className="text-[11px] font-mono truncate" style={{ color: 'var(--arty-muted)' }}>
          {url}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-serif italic flex-shrink-0 ml-2"
          style={{ color: 'var(--arty-accent)' }}
        >
          ouvrir →
        </a>
      </div>
      <div className="p-2">
        <img
          src={screenshot}
          alt={`Capture de ${url}`}
          className="w-full"
          style={{ border: '1px solid var(--arty-line)', borderRadius: 2 }}
        />
      </div>
    </div>
  )
}
