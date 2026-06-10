// Toast minimaliste — bus d'event window (pattern maison : 'cost-updated',
// 'tasks-updated', etc.). Remplace les alert() natifs et les actions sans
// feedback (partage, import, fichiers refusés). Le composant <Toaster />
// monté dans App écoute 'arty-toast' et affiche les messages.

export type ToastType = 'info' | 'success' | 'error'

export interface ToastDetail {
  id: number
  message: string
  type: ToastType
}

let nextId = 1

export function toast(message: string, type: ToastType = 'info'): void {
  try {
    window.dispatchEvent(
      new CustomEvent<ToastDetail>('arty-toast', {
        detail: { id: nextId++, message, type },
      })
    )
  } catch {
    // Contexte sans window (tests) — no-op.
  }
}
