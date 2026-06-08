/**
 * Lemon Squeezy checkout service.
 *
 * Builds the checkout URL with the user's email pre-filled, then opens it in
 * the in-app Capacitor browser (native) or a new tab (web). On native, the
 * `browserFinished` event fires when the user closes the in-app browser —
 * we relay that to an optional `onReturn` callback so the caller can refresh
 * the subscription status.
 *
 * Test-mode variant IDs live in `CHECKOUT_URLS`. Swap them with the
 * production variants once the store goes live.
 */

import { Capacitor } from '@capacitor/core'
import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

export type CheckoutPlan = 'subscription' | 'pro' | 'premium_pack'

export const CHECKOUT_URLS: Readonly<Record<CheckoutPlan, string>> = {
  subscription:
    'https://tryarty.lemonsqueezy.com/checkout/buy/3e26614c-486d-4c94-be84-fda1b03b138f',
  pro:
    'https://tryarty.lemonsqueezy.com/checkout/buy/8a3aa7d6-9e73-4be3-b00b-6ce79db3a1b9',
  premium_pack:
    'https://tryarty.lemonsqueezy.com/checkout/buy/4b822170-2641-4c3a-95c6-c1f9de7db474',
}

function buildCheckoutUrl(plan: CheckoutPlan, email: string): string {
  const base = CHECKOUT_URLS[plan]
  const encoded = encodeURIComponent(email)
  // Lemon Squeezy uses bracketed query params: checkout[email] pre-fills the
  // email field, checkout[custom][user_email] is forwarded to the webhook so
  // the backend can match the order back to the Arty account.
  return `${base}?checkout[email]=${encoded}&checkout[custom][user_email]=${encoded}`
}

export interface OpenCheckoutOptions {
  /** Called after the in-app browser closes (native) or immediately after
   *  opening a new tab (web). Use this to refresh subscription status. */
  onReturn?: () => void
}

/**
 * Open the Lemon Squeezy checkout for the given plan.
 *
 * On native (Capacitor), uses `@capacitor/browser` with a popover
 * presentation and listens once for `browserFinished`. On web, opens a new
 * tab via `window.open` and fires `onReturn` immediately (the web flow can't
 * detect tab closure reliably).
 */
export async function openCheckout(
  plan: CheckoutPlan,
  email: string,
  options: OpenCheckoutOptions = {}
): Promise<void> {
  const url = buildCheckoutUrl(plan, email)
  await openExternalUrl(url, options.onReturn)
}

/**
 * Open an external checkout URL: in-app Capacitor browser on native (with a
 * one-shot `browserFinished` listener wired to `onReturn`), a new tab on web
 * (where tab-closure isn't observable, so `onReturn` fires immediately).
 * Shared by the Lemon Squeezy (`openCheckout`) and Creem (`openCreemCheckout`)
 * flows — the only difference between them is how the URL is obtained.
 */
async function openExternalUrl(url: string, onReturn?: () => void): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')

    if (onReturn) {
      // `addListener` resolves to a handle whose `.remove()` detaches the
      // listener. We capture the handle synchronously so we can detach it
      // from inside the callback once the browser closes.
      const handlePromise = Browser.addListener('browserFinished', async () => {
        try {
          onReturn()
        } finally {
          const handle = await handlePromise
          await handle.remove()
        }
      })
    }

    await Browser.open({ url, presentationStyle: 'popover' })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
  // Best-effort on web: fire the callback so the caller can poll the status
  // endpoint. The user may finish checkout in a separate tab and never come
  // back — that's fine, the next API call will surface the new state.
  if (onReturn) onReturn()
}

/**
 * Buy prepaid credits via Creem (dynamic checkout). Unlike the static Lemon
 * Squeezy links, this POSTs to our server endpoint, which stamps the verified
 * Google email into `metadata.app_user_email` so the webhook credits the right
 * wallet no matter what email the buyer types on Creem's page. Returns the
 * hosted `checkout_url`, which we open like any other checkout.
 *
 * The credit itself is asynchronous (Creem webhook → D1), so the caller should
 * refresh the balance in `onReturn` (poll, since the webhook may land after the
 * browser closes). BUG 4: check `res.ok` before `json()`. BUG 23: take the
 * token via `getValidAccessToken()` (auto-refreshed), never the raw stored one.
 *
 * @returns `true` if the checkout opened, `false` on any failure (no token,
 *          endpoint error, missing URL) — the caller surfaces the error.
 */
export async function openCreemCheckout(
  pack: string,
  options: OpenCheckoutOptions = {}
): Promise<boolean> {
  const token = await getValidAccessToken()
  if (!token) return false

  let url: string
  try {
    const res = await fetch(apiUrl('/api/checkout/creem'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-google-token': token,
      },
      body: JSON.stringify({ pack }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { url?: string }
    if (!data.url) return false
    url = data.url
  } catch {
    return false
  }

  await openExternalUrl(url, options.onReturn)
  return true
}
