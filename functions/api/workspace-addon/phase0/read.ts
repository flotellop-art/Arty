import { buildMessageCard, renderCard } from './_lib/cards'
import { parseWorkspaceEvent, requireGmailActionContext, requireGmailContext } from './_lib/event'
import { readCurrentMessage } from './_lib/gmail'
import { createPhase0Handler } from './_lib/runtime'

const CURRENT_MESSAGE_ACTION_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.message.action'

export const onRequestPost = createPhase0Handler({
  route: 'read',
  parseEvent: (raw) => requireGmailContext(parseWorkspaceEvent(raw)),
  requiredScopes: [CURRENT_MESSAGE_ACTION_SCOPE],
  handle: async ({ event, fetcher, signal, config, actionNonce }) => {
    const actionEvent = requireGmailActionContext(event)
    const message = await readCurrentMessage(actionEvent, fetcher, signal)
    return renderCard(buildMessageCard(message, config, actionNonce))
  },
})
