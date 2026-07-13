/**
 * PR-0 (CDC Phase 1, D26/D29) — les quatre connecteurs Google du client
 * public (Gmail, Drive, Contacts, Sheets) sont tombstonés : HTTP 410 Gone,
 * corps uniforme, renvoyé AVANT toute authentification — la réponse ne
 * devient jamais un oracle d'auth et aucun aller-retour Google n'est
 * dépensé pour une capacité retirée. Les routes sont déjà publiques dans
 * le bundle client : le 410 ne révèle rien de plus.
 *
 * Décision du 13 juillet 2026 : coupure ACTIVE PAR DÉFAUT (« coupure
 * immédiate »). LEGACY_GOOGLE_CONNECTORS_ENABLED='true' est la variable
 * d'échappement d'urgence : elle réactive les handlers historiques sans
 * redéploiement (rollback ops, même pattern que
 * WORKSPACE_ADDON_PHASE0_ENABLED).
 *
 * PR-B0 retirera ATOMIQUEMENT 'drive' de TOMBSTONED_CONNECTORS (D29) —
 * Gmail/Contacts/Sheets restent en 410.
 */
const TOMBSTONED_CONNECTORS = new Set(['gmail', 'drive', 'contacts', 'sheets'])

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function tombstonedConnectors(): ReadonlySet<string> {
  return TOMBSTONED_CONNECTORS
}

export function isConnectorTombstoned(connector: string, env: unknown): boolean {
  if (!TOMBSTONED_CONNECTORS.has(connector)) return false
  const legacy = (env as { LEGACY_GOOGLE_CONNECTORS_ENABLED?: string } | undefined)
    ?.LEGACY_GOOGLE_CONNECTORS_ENABLED
  return !(typeof legacy === 'string' && TRUE_VALUES.has(legacy.trim().toLowerCase()))
}

export function tombstoneResponse(): Response {
  return Response.json({ error: 'Gone' }, { status: 410 })
}
