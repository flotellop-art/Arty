import i18n from '../../i18n'
import { toast, type ToastType } from '../toast'
import type { RouteOverride } from './types'

export type RouteOverrideNotifier = (message: string, type?: ToastType) => void

function requestedProviderLabel(requested: string): string {
  return requested === 'openai'
    ? 'ChatGPT'
    : requested.charAt(0).toUpperCase() + requested.slice(1)
}

/**
 * Rend visibles les seules contradictions d'un choix manuel. Les décisions
 * Auto ont toujours `overrides = []` et ne produisent donc aucun toast.
 * L'injection du notifier garde ce contrat testable sans monter tout le hook.
 */
export function notifyRouteOverrides(
  overrides: readonly RouteOverride[],
  notify: RouteOverrideNotifier = toast
): void {
  for (const override of overrides) {
    notify(
      i18n.t(`chat.override.${override.reason.code}`, {
        requested: requestedProviderLabel(override.requested),
      }),
      'info'
    )
  }
}
