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
// ⚠️ ALLOWLIST POSITIVE : un tool absent du switch passe SANS confirmation.
// Tout nouveau tool déclaré dans toolDefinitions.ts DOIT être classé dans le
// test de parité de toolConfirmation.test.ts (confirm ou safe), qui échoue
// sinon. Les BOUTONS d'action ont leur propre allowlist, maintenue séparément
// dans useAppSetup.ts (handleAction) — garder les deux en tête lors d'un ajout.
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
    // publication publique exige un consentement. `!== 'draft'` couvre
    // 'publish' ET 'future' (publication programmée = publique à terme).
    case 'wp_create_post':
      return ((input.status as string) || 'draft') !== 'draft'
        ? t('chat.actionConfirm.wp', { title: (input.title as string) || '?' })
        : null
    // Audit F-1 (3 juil. 2026) : sans ce case, prompt-injection = création
    // draft (libre) puis update en 'publish' (libre) → article publié sans
    // aucun consentement. Un update qui ne touche pas au status reste libre.
    case 'wp_update_post':
      return input.status !== undefined && input.status !== 'draft'
        ? t('chat.actionConfirm.wp', { title: (input.title as string) || '?' })
        : null
    default:
      return null
  }
}
