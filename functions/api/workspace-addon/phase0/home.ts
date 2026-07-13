import { buildHomeCard, renderCard } from './_lib/cards'
import { parseWorkspaceEvent } from './_lib/event'
import { createPhase0Handler } from './_lib/runtime'

export const onRequestPost = createPhase0Handler({
  route: 'home',
  parseEvent: parseWorkspaceEvent,
  handle: () => renderCard(buildHomeCard()),
})
