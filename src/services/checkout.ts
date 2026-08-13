/**
 * Lemon Squeezy checkout service.
 *
 * Requests a short-lived checkout URL from the server, then opens it on the
 * web. The server selects the Test/Live variant from Cloudflare configuration
 * and stamps the verified Google email; no provider ID or API key is shipped
 * in the browser bundle. Public native builds fail closed before any checkout
 * request is reached.
 */

import { Capacitor } from '@capacitor/core'
import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import { isNative } from './native/platform'

/**
 * Play Store — les biens numériques vendus DANS l'app Android doivent passer
 * par Google Play Billing (ou le « billing choice program », non intégré).
 * Sur natif, aucun checkout ne doit s'ouvrir : les achats se font sur le web
 * (tryarty.com), le plan est côté serveur (D1) donc le statut se synchronise
 * dans l'app. `canPurchase` est le point de vérité unique pour l'UI ;
 * `openCheckout`/`openCreemCheckout` re-vérifient en filet de sécurité.
 */
export const canPurchase = !isNative

/**
 * Store-scoped Lemon Squeezy customer portal. This is a subscription
 * management/cancellation destination, not a checkout URL. Google Play's
 * subscriptions policy requires an easy online cancellation path; keep the
 * portal available to existing subscribers while every purchase entry point
 * remains gated by `canPurchase` on native.
 */
export const SUBSCRIPTION_PORTAL_URL = 'https://tryarty.lemonsqueezy.com/billing'

export type CheckoutPlan = 'subscription' | 'pro' | 'premium_pack'

export interface OpenCheckoutOptions {
  /** Called after an in-app browser closes. Web checkouts return through the
   * provider redirect URL and refresh from the destination screen. */
  onReturn?: () => void
}

/**
 * Open the Lemon Squeezy checkout for the given plan. The POST uses the same
 * audience-checked Google token as the Creem checkout. On web, navigation is
 * same-tab because a popup opened after token refresh + fetch would be blocked
 * by mobile browsers; Lemon Squeezy redirects to `/upgrade` after payment.
 */
export async function openCheckout(
  plan: CheckoutPlan,
  options: OpenCheckoutOptions = {}
): Promise<boolean> {
  if (!canPurchase) return false
  const token = await getValidAccessToken()
  if (!token) return false

  let url: string
  try {
    const response = await fetch(apiUrl('/api/checkout/lemonsqueezy'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-google-token': token,
      },
      body: JSON.stringify({ plan }),
    })
    if (!response.ok) return false
    const data = (await response.json()) as { url?: string }
    if (!data.url) return false
    url = data.url
  } catch {
    return false
  }

  if (Capacitor.isNativePlatform()) {
    await openExternalUrl(url, options.onReturn)
  } else {
    window.location.assign(url)
  }
  return true
}

/**
 * Open an external checkout URL: in-app Capacitor browser on native (with a
 * one-shot `browserFinished` listener wired to `onReturn`), a new tab on web
 * (where tab-closure isn't observable, so `onReturn` fires immediately).
 * Shared by the defensive native branches of Lemon Squeezy and Creem.
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
  if (!canPurchase) return false
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

  if (Capacitor.isNativePlatform()) {
    // Natif : navigateur in-app Capacitor + browserFinished → refresh via onReturn.
    await openExternalUrl(url, options.onReturn)
  } else {
    // Web : redirection plein écran. window.open() APRÈS des await (token +
    // fetch endpoint) est bloqué par les bloqueurs de pop-up mobiles — le geste
    // du clic est « consommé » par les await → « rien ne se passe ». Une
    // navigation same-tab n'est JAMAIS bloquée ; Creem renvoie sur success_url
    // après paiement et le badge se rafraîchit au rechargement de retour.
    window.location.assign(url)
  }
  return true
}
