import { buildContextCard, renderCard } from './_lib/cards'
import { parseWorkspaceEvent, requireGmailContext } from './_lib/event'
import { createPhase0Handler } from './_lib/runtime'

export const onRequestPost = createPhase0Handler({
  route: 'context',
  parseEvent: (raw) => requireGmailContext(parseWorkspaceEvent(raw)),
  handle: ({ config, actionNonce }) => renderCard(buildContextCard(config, actionNonce)),
})
