import {
  PHASE0_ROUTE_PATHS,
  type GmailMessageView,
  type HostActionShape,
  type Phase0Config,
  type Phase0RouteName,
} from './types'

type Card = Record<string, unknown>

function escapeCardText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraph(text: string): Record<string, unknown> {
  return { textParagraph: { text: escapeCardText(text) } }
}

function actionButton(text: string, endpoint: string, actionNonce?: string): Record<string, unknown> {
  return {
    text,
    onClick: {
      action: {
        function: endpoint,
        loadIndicator: 'SPINNER',
        ...(actionNonce
          ? { parameters: [{ key: 'phase0_action_nonce', value: actionNonce }] }
          : {}),
      },
    },
  }
}

function replyWidgets(config: Phase0Config, actionNonce: string): Record<string, unknown>[] {
  return [
    {
      textInput: {
        name: 'phase0_reply_body',
        label: 'Texte du brouillon de test',
        type: 'MULTIPLE_LINE',
        value: 'Bonjour,\n\nMerci pour votre message.\n',
        validation: { characterLimit: 5_000 },
      },
    },
    {
      buttonList: {
        buttons: [
          actionButton(
            'Tester le brouillon dans ce fil',
            phase0RouteUrl(config, 'create-draft'),
            actionNonce,
          ),
        ],
      },
    },
  ]
}

export function phase0RouteUrl(config: Phase0Config, route: Phase0RouteName): string {
  return new URL(PHASE0_ROUTE_PATHS[route], config.baseUrl).toString()
}

export function renderCard(card: Card): Record<string, unknown> {
  return {
    renderActions: {
      action: {
        navigations: [{ pushCard: card }],
      },
    },
  }
}

export function buildHomeCard(): Card {
  return {
    header: {
      title: 'Arty — Gate HTTP Gmail',
      subtitle: 'Phase 0, accès contextuel uniquement',
    },
    sections: [
      {
        widgets: [
          paragraph('Ouvrez un message Gmail pour tester la lecture après clic et la création contrôlée d’un brouillon de réponse.'),
          paragraph('Aucun message n’est lu depuis cette page d’accueil.'),
        ],
      },
    ],
  }
}

export function buildContextCard(config: Phase0Config, actionNonce: string): Card {
  return {
    header: {
      title: 'Message courant',
      subtitle: 'Aucune lecture avant votre clic',
    },
    sections: [
      {
        widgets: [
          paragraph('Le contexte Gmail a été reçu, mais le contenu du message n’a pas encore été demandé.'),
          {
            buttonList: {
              buttons: [
                actionButton('Lire le message courant', phase0RouteUrl(config, 'read')),
              ],
            },
          },
          ...replyWidgets(config, actionNonce),
        ],
      },
    ],
  }
}

export function buildMessageCard(
  message: GmailMessageView,
  config: Phase0Config,
  actionNonce: string,
): Card {
  const truncation = message.bodyTruncated
    ? '\n\n[Contenu tronqué pour rester dans la limite de la carte Phase 0.]'
    : ''
  return {
    header: {
      title: escapeCardText(message.subject || '(Sans objet)'),
      subtitle: escapeCardText(message.from || '(Expéditeur indisponible)'),
    },
    sections: [
      {
        header: 'Contenu lu après clic',
        widgets: [
          paragraph(`${message.body || '(Corps vide)'}${truncation}`),
        ],
      },
      {
        header: 'Gate de création du brouillon',
        widgets: replyWidgets(config, actionNonce),
      },
    ],
  }
}

export function buildErrorCard(code: string, upstreamStatus?: number): Card {
  const suffix = upstreamStatus === undefined ? '' : ` (HTTP amont ${upstreamStatus})`
  return {
    header: {
      title: 'Phase 0 arrêtée proprement',
      subtitle: 'Aucun envoi de message n’a été effectué',
    },
    sections: [
      {
        widgets: [
          paragraph(`Code : ${code}${suffix}`),
          paragraph('Cette erreur est conservée comme résultat du gate. Aucun jeton ni contenu n’est journalisé.'),
        ],
      },
    ],
  }
}

export function buildDraftHostAction(
  shape: HostActionShape,
  draftId: string,
  rpcThreadServerPermId: string,
  legacyDraftThreadId: string,
): Record<string, unknown> {
  if (shape === 'rpc') {
    return {
      renderActions: {
        hostAppAction: {
          gmailAction: {
            openCreatedDraftAction: {
              // The current RPC schema uses Gmail host server-permanent IDs,
              // while users.drafts.create returns the REST Draft.id (`r-*`).
              // Google documents the resulting host shape as `msg-a:r-*`.
              draftId: draftId.startsWith('msg-a:') ? draftId : `msg-a:${draftId}`,
              threadServerPermId: rpcThreadServerPermId,
            },
          },
        },
      },
    }
  }

  return {
    renderActions: {
      hostAppAction: {
        gmailAction: {
          openCreatedDraftActionMarkup: {
            draftId,
            draftThreadId: legacyDraftThreadId,
          },
        },
      },
    },
  }
}
