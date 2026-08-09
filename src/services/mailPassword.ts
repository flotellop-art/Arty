// Normalisation des mots de passe de boîtes mail avant l'appel au plugin
// IMAP natif (BUG 66). Google affiche les mots de passe d'application en
// 4 groupes de 4 lettres séparés par des espaces (parfois insécables selon le
// rendu) ; collés tels quels, Gmail les rejette — le serveur ne strippe pas
// les espaces cosmétiques. Même piège avec un espace final ajouté par le
// clavier Android après un collage.
//
// Deux règles, en union :
// - règle HOST : les serveurs qui n'acceptent QUE des mots de passe
//   d'application (jamais d'espace dans le secret) → retrait de tous les
//   blancs. Keyée sur le host, pas sur le preset UI : un provider « IMAP »
//   custom pointé sur imap.gmail.com doit être couvert aussi.
// - règle de FORME : 16 minuscules en 4 groupes de 4 = la forme canonique
//   d'un mot de passe d'application Google/Yahoo, quel que soit le host.
// Tout le reste (Free, IMAP générique) : simple trim — un mot de passe IMAP
// légal peut contenir des espaces internes (RFC 3501).
//
// Filet anti-régression : `mailPasswordCandidates` renvoie [normalisé, brut]
// quand ils diffèrent — l'appelant tente le normalisé d'abord, puis le brut
// sur échec d'authentification. Aucun mot de passe légal ne peut être cassé.
// Les tirets (iCloud : xxxx-xxxx-xxxx-xxxx) ne sont JAMAIS retirés.

// \s en JavaScript couvre déjà les blancs Unicode collés depuis les UI des
// fournisseurs : U+00A0 (NBSP), U+202F (NNBSP), U+2007, U+FEFF…
const APP_PASSWORD_SHAPE = /^[a-z]{4}(?:\s[a-z]{4}){3}$/

function isAppPasswordOnlyHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === 'imap.gmail.com' || h === 'imap.mail.yahoo.com' || h.startsWith('imap.mail.yahoo.')
}

export function normalizeMailPassword(password: string, host: string): string {
  const trimmed = password.replace(/^\s+|\s+$/g, '')
  if (isAppPasswordOnlyHost(host) || APP_PASSWORD_SHAPE.test(trimmed)) {
    return trimmed.replace(/\s+/g, '')
  }
  return trimmed
}

/**
 * Candidats à essayer dans l'ordre : normalisé d'abord (le plus probablement
 * correct — et Gmail verrouille temporairement après plusieurs échecs, donc
 * on ne brûle pas une tentative), puis le brut en filet si la normalisation
 * a changé quelque chose.
 */
export function mailPasswordCandidates(password: string, host: string): string[] {
  const normalized = normalizeMailPassword(password, host)
  return normalized === password ? [password] : [normalized, password]
}
