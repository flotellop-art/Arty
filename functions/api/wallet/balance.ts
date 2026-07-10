import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'
import { getWalletBalance } from '../_lib/wallet'

// GET /api/wallet/balance — solde de crédits prépayés de l'utilisateur.
//
// Auth (RÈGLE 6) : token Google vérifié ; l'email vient du token, JAMAIS d'un
// champ client (pas d'IDOR). Read-only — ne décrémente aucun compteur (pas
// `checkAllowedUser`, qui exigerait un plan : un user wallet est "free"). Solde
// nul si pas de wallet OU si D1 est indisponible (getWalletBalance est résilient
// → jamais de 500 ici). GET → exempt du gate Origin du middleware.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const bal = await getWalletBalance(env, email)
  return Response.json({
    hasWallet: bal !== null,
    balanceMicro: bal?.balanceMicro ?? 0,
    reservedMicro: bal?.reservedMicro ?? 0,
    availableMicro: bal?.availableMicro ?? 0,
  })
}
