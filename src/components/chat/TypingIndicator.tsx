import { memo } from 'react'
import { StarIcon } from '../shared/StarIcon'
import { Tag } from '../shared/editorial'

export const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="mb-5 max-w-[94%]">
      <div className="flex items-center gap-2 mb-1.5">
        <StarIcon size={14} animated active />
        <Tag>Arty écrit…</Tag>
      </div>
      <div
        className="flex items-center gap-1.5 py-2"
        style={{ paddingLeft: 20, borderLeft: '2px solid var(--arty-line)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full typing-dot-1" style={{ backgroundColor: 'var(--arty-accent)' }} />
        <span className="w-1.5 h-1.5 rounded-full typing-dot-2" style={{ backgroundColor: 'var(--arty-accent)' }} />
        <span className="w-1.5 h-1.5 rounded-full typing-dot-3" style={{ backgroundColor: 'var(--arty-accent)' }} />
      </div>
    </div>
  )
})
