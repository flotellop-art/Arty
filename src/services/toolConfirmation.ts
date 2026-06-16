import type { TFunction } from 'i18next'

// HITL — consentement humain avant une action SENSIBLE déclenchée par le modèle
// DANS LA BOUCLE D'OUTILS. Le modèle peut appeler ces outils tout seul, y
// compris sous l'effet d'une prompt-injection cachée dans un email / fichier /
// page qu'il vient de lire (RÈGLE 6, BUG 42). Le « CONFIRMATION OBLIGATOIRE »
// des descriptions d'outils n'est qu'une consigne au LLM, pas un garde : le
// vrai consentement est imposé par buildToolConfirmMessage, exactement comme
// handleAction le fait déjà pour les boutons générés dans les messages.
//
// Critère d'inclusion (premiers principes) : une action requiert confirmation
// si elle est (a) irréversible/destructive OU (b) envoie/expose des données à
// un tiers. Toute lecture/recherche/listing reste libre (pas de garde).
//
// Retourne le message à confirmer, ou null si l'action ne requiert pas de garde.
export function buildToolConfirmMessage(
  name: string,
  input: Record<string, unknown>,
  t: TFunction
): string | null {
  switch (name) {
    // Envoi externe / exfiltration
    case 'send_email':
    case 'reply_email':
      return t('chat.actionConfirm.email', { to: (input.to as string) || '?' })
    case 'share_drive_file':
      return t('chat.actionConfirm.shareDrive', { email: (input.email as string) || '?' })
    // Suppression destructive
    case 'delete_email':
      return t('chat.actionConfirm.deleteEmail')
    case 'delete_drive_file':
      return t('chat.actionConfirm.deleteDrive')
    case 'delete_calendar_event':
      return t('chat.actionConfirm.deleteEvent')
    case 'delete_local_file':
      return t('chat.actionConfirm.deleteLocal')
    case 'wp_delete_post':
      return t('chat.actionConfirm.deleteWp')
    // WordPress : le brouillon reste libre (cf. system prompt), seule la
    // publication publique exige un consentement.
    case 'wp_create_post':
    case 'publish_wordpress':
      return ((input.status as string) || 'draft') === 'publish'
        ? t('chat.actionConfirm.wp', { title: (input.title as string) || '?' })
        : null
    default:
      return null
  }
}
