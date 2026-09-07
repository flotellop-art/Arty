import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'
import { readWalletBalance } from '../_lib/wallet'

// GET /api/wallet/balance — solde de crédits prépayés de l'utilisateur.
//
// Auth (RÈGLE 6) : token Google vérifié ; l'email vient du token, JAMAIS d'un
// champ client (pas d'IDOR). Read-only — ne décrémente aucun compteur (pas
// `checkAllowedUser`, qui exigerait un plan : un user wallet est "free"). Solde
// Absence confirmée => zéro ; panne/timeout => 503 sans faux solde.
// GET → exempt du gate Origin du middleware. Aucun mouvement financier.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const result = await readWalletBalance(env, email)
  if (result.status === 'unavailable') return Response.json(
    { error: 'wallet_temporarily_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } },
  )
  const bal = result.status === 'ready' ? result.balance : null
  return Response.json({
    hasWallet: bal !== null,
    balanceMicro: bal?.balanceMicro ?? 0,
    reservedMicro: bal?.reservedMicro ?? 0,
    availableMicro: bal?.availableMicro ?? 0,
    reversalPending: bal?.reversalPending ?? false,
  }, { headers: { 'cache-control': 'no-store' } })
}
