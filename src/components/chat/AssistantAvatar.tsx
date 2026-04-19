import { memo } from 'react'
import { PrismMark } from '../shared/PrismMark'

export const AssistantAvatar = memo(function AssistantAvatar() {
  return (
    <div className="flex-shrink-0 mt-1 text-theme-accent">
      <PrismMark size={20} fill />
    </div>
  )
})
