interface UserBubbleProps {
  content: string
}

export function UserBubble({ content }: UserBubbleProps) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[85%] bg-bubble-user text-cream px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed font-light whitespace-pre-wrap">
        {content}
      </div>
    </div>
  )
}
