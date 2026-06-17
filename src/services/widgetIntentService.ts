import { registerPlugin } from '@capacitor/core'

export interface WidgetActionPayload {
  source: string | null
  action: 'open_chat' | null
}

interface WidgetIntentPlugin {
  getPendingAction(): Promise<WidgetActionPayload>
  addListener(
    eventName: 'widgetAction',
    listener: (payload: WidgetActionPayload) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

const plugin = registerPlugin<WidgetIntentPlugin>('WidgetIntent')

function isEmpty(payload: WidgetActionPayload | null | undefined): boolean {
  if (!payload) return true
  return !payload.source && !payload.action
}

export async function getPendingWidgetAction(): Promise<WidgetActionPayload | null> {
  try {
    const payload = await plugin.getPendingAction()
    return isEmpty(payload) ? null : payload
  } catch {
    return null
  }
}

export async function addWidgetActionListener(
  handler: (payload: WidgetActionPayload) => void,
): Promise<() => void> {
  try {
    const sub = await plugin.addListener('widgetAction', (payload) => {
      if (!isEmpty(payload)) handler(payload)
    })
    return () => {
      void sub.remove()
    }
  } catch {
    return () => {}
  }
}
