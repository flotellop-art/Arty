import { memo } from 'react'
import { StarIcon } from '../shared/StarIcon'

export const AssistantAvatar = memo(function AssistantAvatar() {
  return (
    <div className="flex-shrink-0 mt-1">
      <StarIcon size={22} />
    </div>
  )
})
