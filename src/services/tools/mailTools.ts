import type { ToolHandler } from './types'
import { markUntrustedThirdPartyData } from './untrustedContent'
import { getCachedMailAccounts, hasConnectedMailAccounts } from '../mailAccounts'
import {
  checkMailAccount,
  recentMailMessages,
  searchMailMessages,
  readMailMessage,
  type MailMessageSummary,
} from '../native/mailImap'

// Outils LECTURE SEULE sur les boîtes mail connectées via le client IMAP
// natif Android (MailImapPlugin). Décision « natif d'abord » du 9 août 2026.
//
// - Ces définitions ne sont PAS dans TOOLS : elles sont injectées
//   conditionnellement par useConversation quand ≥1 compte est connecté
//   (pattern imageTools/P1.3) — sinon le modèle annoncerait une capacité
//   inexistante (classe F-3 « tools sur routes mortes »).
// - Les handlers ne reçoivent JAMAIS de mot de passe : ils référencent un
//   compte par son id opaque, le natif résout le credential dans le Keystore.
// - Tout contenu provenant d'un mail est encadré par
//   markUntrustedThirdPartyData : c'est de la donnée externe potentiellement
//   hostile (prompt-injection), jamais des instructions.

export const mailToolDefinitions = [
  {
    name: 'list_mail_accounts',
    description:
      "Lister les boîtes mail connectées par l'utilisateur (fournisseur, adresse) et leur état.",
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_recent_mail',
    description:
      "Voir les derniers messages reçus d'une boîte mail connectée (objet, expéditeur, date). Lecture seule.",
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: {
          type: 'string' as const,
          description: "Id du compte (list_mail_accounts). Optionnel s'il n'y a qu'une boîte.",
        },
        limit: { type: 'number' as const, description: 'Nombre de messages (défaut 10, max 20)' },
      },
    },
  },
  {
    name: 'search_mail',
    description:
      "Rechercher dans une boîte mail connectée (objet, expéditeur, contenu). Lecture seule.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Termes de recherche (max 128 caractères)' },
        account_id: {
          type: 'string' as const,
          description: "Id du compte (list_mail_accounts). Optionnel s'il n'y a qu'une boîte.",
        },
        limit: { type: 'number' as const, description: 'Nombre de résultats (défaut 10, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_mail',
    description:
      "Lire le contenu d'un message d'une boîte mail connectée (uid retourné par get_recent_mail ou search_mail). Lecture seule.",
    input_schema: {
      type: 'object' as const,
      properties: {
        uid: { type: 'number' as const, description: 'UID du message' },
        account_id: {
          type: 'string' as const,
          description: "Id du compte (list_mail_accounts). Optionnel s'il n'y a qu'une boîte.",
        },
      },
      required: ['uid'],
    },
  },
]

/** True quand les outils mail doivent être exposés au modèle. */
export function mailToolsAvailable(): boolean {
  return hasConnectedMailAccounts()
}

const MAIL_ERROR_MESSAGES: Record<string, string> = {
  auth_failed:
    "Authentification refusée par le serveur mail. L'utilisateur doit re-vérifier son mot de passe d'application dans Réglages → Boîtes mail.",
  connect_failed: 'Connexion au serveur mail impossible (réseau ou serveur indisponible).',
  account_not_found: 'Ce compte mail n\'existe plus. Utilise list_mail_accounts.',
  message_not_found: 'Message introuvable (il a pu être déplacé ou supprimé).',
  no_active_user: 'Aucune session active.',
}

function mailErrorResult(err: unknown): { result: string } {
  const code = err instanceof Error ? err.message : String(err)
  return { result: MAIL_ERROR_MESSAGES[code] ?? 'Erreur de lecture de la boîte mail.' }
}

function resolveAccountId(input: Record<string, unknown>): string | null {
  const requested = typeof input.account_id === 'string' ? input.account_id : ''
  const accounts = getCachedMailAccounts()
  if (requested) {
    return accounts.some((a) => a.id === requested) ? requested : null
  }
  const only = accounts.length === 1 ? accounts[0] : undefined
  return only ? only.id : null
}

function formatSummaries(messages: MailMessageSummary[]): string {
  return messages
    .map((m, i) => `${i + 1}. [uid ${m.uid}] ${m.date.slice(0, 10)} — ${m.from} — ${m.subject}`)
    .join('\n')
}

export function createMailHandlers(): Record<string, ToolHandler> {
  return {
    list_mail_accounts: async () => {
      const accounts = getCachedMailAccounts()
      if (accounts.length === 0) {
        return {
          result:
            "Aucune boîte mail connectée. L'utilisateur peut en ajouter une dans Réglages → Boîtes mail (app Android).",
        }
      }
      const lines = await Promise.all(
        accounts.map(async (a) => {
          try {
            const status = await checkMailAccount(a.id)
            return `- ${a.label || a.provider} (${a.email}) [id ${a.id}] : ${status.messageCount} messages, ${status.unreadCount} non lus`
          } catch {
            return `- ${a.label || a.provider} (${a.email}) [id ${a.id}] : injoignable actuellement`
          }
        })
      )
      return { result: `${accounts.length} boîte(s) connectée(s):\n${lines.join('\n')}` }
    },

    get_recent_mail: async (input) => {
      const accountId = resolveAccountId(input)
      if (!accountId) {
        return { result: 'Compte introuvable ou ambigu. Utilise list_mail_accounts pour choisir un account_id.' }
      }
      try {
        const limit = typeof input.limit === 'number' ? input.limit : 10
        const { messages, total } = await recentMailMessages(accountId, limit)
        if (messages.length === 0) return { result: 'Boîte de réception vide.' }
        return {
          result: markUntrustedThirdPartyData(
            'Boîte mail (IMAP)',
            `${messages.length} derniers messages (${total} au total):\n${formatSummaries(messages)}`
          ),
        }
      } catch (err) {
        return mailErrorResult(err)
      }
    },

    search_mail: async (input) => {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (!query) return { result: 'Requête de recherche vide.' }
      const accountId = resolveAccountId(input)
      if (!accountId) {
        return { result: 'Compte introuvable ou ambigu. Utilise list_mail_accounts pour choisir un account_id.' }
      }
      try {
        const limit = typeof input.limit === 'number' ? input.limit : 10
        const { messages, totalMatches } = await searchMailMessages(accountId, query, limit)
        if (messages.length === 0) return { result: `Aucun message trouvé pour « ${query} ».` }
        return {
          result: markUntrustedThirdPartyData(
            'Boîte mail (IMAP)',
            `${totalMatches} résultat(s) pour « ${query} » (les ${messages.length} plus récents):\n${formatSummaries(messages)}`
          ),
        }
      } catch (err) {
        return mailErrorResult(err)
      }
    },

    read_mail: async (input) => {
      const uid = typeof input.uid === 'number' ? input.uid : NaN
      if (!Number.isFinite(uid) || uid < 0) return { result: 'UID de message invalide.' }
      const accountId = resolveAccountId(input)
      if (!accountId) {
        return { result: 'Compte introuvable ou ambigu. Utilise list_mail_accounts pour choisir un account_id.' }
      }
      try {
        const msg = await readMailMessage(accountId, uid)
        return {
          result: markUntrustedThirdPartyData(
            'Boîte mail (IMAP)',
            [
              `De: ${msg.from}`,
              `À: ${msg.to}`,
              `Date: ${msg.date}`,
              `Objet: ${msg.subject}`,
              '',
              msg.body || '(message sans contenu texte)',
            ].join('\n')
          ),
        }
      } catch (err) {
        return mailErrorResult(err)
      }
    },
  }
}
