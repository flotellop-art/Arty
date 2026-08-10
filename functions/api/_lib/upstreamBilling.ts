// Détection « le problème vient de l'état de la clé/du compte du propriétaire,
// pas de la requête de l'utilisateur ».
//
// Extrait de `functions/api/ai/proxy.ts` (BUG 64, 9 août 2026) au moment de
// porter la même leçon sur les autres routes : masquer le DÉTAIL d'une erreur
// upstream protège l'état de la clé owner, masquer la CATÉGORIE supprime tout
// diagnostic. La première fois, ça a coûté quatre correctifs de payload avant
// de découvrir que le solde Anthropic était à zéro. Le correctif n'avait alors
// été appliqué qu'à Anthropic — le 10 août, un « Erreur OpenAI (400) »
// indéchiffrable a fait exactement la même chose un provider plus loin.
//
// Partagé pour ne pas dériver : chaque fournisseur formule le même incident à
// sa façon (« credit balance is too low » chez Anthropic, « exceeded your
// current quota […] check your plan and billing details » chez OpenAI), et sur
// un code HTTP qui n'a rien d'évident (400 ou 429 selon les cas, jamais 402).

export const BILLING_LEAK_PATTERN =
  /credit\s*balance|insufficient\s*credit|billing|payment|purchase|invoice|spend\s*limit|upgrade\s+your|your\s+plan|too\s+low|exceed(?:s|ed)?\s+your|organization\s+\w*\s*limit|monthly\s+quota|rate\s*limit/i

/** Le message upstream décrit-il un problème de crédits / facturation / plan ? */
export function isBillingMessage(message: unknown): boolean {
  return typeof message === 'string' && message.trim() !== '' && BILLING_LEAK_PATTERN.test(message)
}

// Codes STRUCTURÉS signalant un compte à sec. Plus fiables qu'une regex de
// message quand le fournisseur en expose (OpenAI, Mistral compat OpenAI).
//
// `rate_limit_exceeded` et `RESOURCE_EXHAUSTED` (Gemini) en sont volontairement
// ABSENTS : ce sont des limites transitoires « réessaie dans 10 secondes », pas
// un compte vide. Les confondre remplacerait une erreur illisible par une
// erreur fausse — « préviens l'administrateur » sur un simple pic de trafic.
const BILLING_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'account_deactivated',
])

/**
 * Classe une réponse d'erreur upstream (corps brut) en catégorie exposable.
 * Retourne le sentinel STABLE `upstream_billing`, ou null s'il n'y a rien de
 * concluant — auquel cas l'appelant garde son masquage générique.
 *
 * Exporté pour les tests : la frontière « bug applicatif » / « état de la clé »
 * est un invariant de sécurité, elle doit être verrouillée.
 */
export function classifyUpstreamBilling(detail: string): 'upstream_billing' | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(detail)
  } catch {
    // Corps non JSON (page d'erreur HTML d'un edge, texte brut) : on se rabat
    // sur le motif textuel, seul signal disponible.
    return isBillingMessage(detail) ? 'upstream_billing' : null
  }
  const error = (parsed as { error?: unknown })?.error
  if (!error || typeof error !== 'object') {
    return isBillingMessage(detail) ? 'upstream_billing' : null
  }
  const { code, type, message } = error as { code?: unknown; type?: unknown; message?: unknown }
  if (typeof code === 'string' && BILLING_CODES.has(code)) return 'upstream_billing'
  if (typeof type === 'string' && BILLING_CODES.has(type)) return 'upstream_billing'
  // Repli textuel : couvre les formes historiques et les fournisseurs qui ne
  // renvoient qu'une phrase (le cas Anthropic d'origine).
  return isBillingMessage(message) ? 'upstream_billing' : null
}
