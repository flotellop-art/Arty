interface ScreenshotCardProps {
  url: string
  screenshot: string
}

export function ScreenshotCard({ url, screenshot }: ScreenshotCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden my-2">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-500 truncate">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline flex-shrink-0 ml-2"
        >
          Ouvrir
        </a>
      </div>
      <div className="p-2">
        <img
          src={screenshot}
          alt={`Capture de ${url}`}
          className="w-full rounded-lg border border-gray-100"
        />
      </div>
    </div>
  )
}
