import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR-0 (CDC Phase 1 D26/D29) — tombstones des quatre connecteurs Google.
 * Contrat testé :
 *  - 410 uniforme PAR DÉFAUT (env absent OU sans variable d'échappement) ;
 *  - le 410 part AVANT toute auth (verifyGoogleUser jamais appelé) ;
 *  - LEGACY_GOOGLE_CONNECTORS_ENABLED='true' réactive le handler réel ;
 *  - parité D29 : exactement {gmail, drive, contacts, sheets} — PR-B0
 *    retirera 'drive' SEUL et devra mettre à jour ce test.
 */

const verifyGoogleUserMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyGoogleUser: verifyGoogleUserMock,
  notFoundResponse: () => Response.json({ error: 'Not found' }, { status: 404 }),
}))
vi.mock('../../../functions/api/_lib/googleFetch', () => ({ googleFetch: vi.fn() }))

import { onRequestPost as gmailPost } from '../../../functions/api/gmail/action'
import { onRequestPost as drivePost } from '../../../functions/api/drive/action'
import { onRequestPost as contactsPost } from '../../../functions/api/contacts/action'
import { onRequestPost as sheetsPost } from '../../../functions/api/sheets/append'
import {
  isConnectorTombstoned,
  tombstonedConnectors,
  tombstoneResponse,
} from '../../../functions/api/_lib/tombstone'

const ENDPOINTS = [
  { name: 'gmail', post: gmailPost, url: 'https://tryarty.com/api/gmail/action' },
  { name: 'drive', post: drivePost, url: 'https://tryarty.com/api/drive/action' },
  { name: 'contacts', post: contactsPost, url: 'https://tryarty.com/api/contacts/action' },
  { name: 'sheets', post: sheetsPost, url: 'https://tryarty.com/api/sheets/append' },
] as const

function call(post: (ctx: never) => Promise<Response> | Response, url: string, env: unknown) {
  return post({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer google-token' },
      body: JSON.stringify({ type: 'list', action: 'append' }),
    }),
    env,
  } as never)
}

describe('tombstones des connecteurs Google (PR-0, D26/D29)', () => {
  beforeEach(() => verifyGoogleUserMock.mockClear())

  it.each(ENDPOINTS)('$name → 410 par défaut, AVANT toute auth (env vide)', async ({ post, url }) => {
    const res = await call(post, url, {})
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'Gone' })
    expect(verifyGoogleUserMock).not.toHaveBeenCalled()
  })

  it.each(ENDPOINTS)('$name → 410 même sans objet env (contexte dégradé)', async ({ post, url }) => {
    const res = await call(post, url, undefined)
    expect(res.status).toBe(410)
    expect(verifyGoogleUserMock).not.toHaveBeenCalled()
  })

  it.each(ENDPOINTS)("$name → la variable d'échappement réactive le handler réel", async ({ post, url }) => {
    const res = await call(post, url, { LEGACY_GOOGLE_CONNECTORS_ENABLED: 'true' })
    // verifyGoogleUser (mocké → null) est atteint : le handler réel répond
    // son 404 uniforme, preuve que le tombstone a été contourné.
    expect(verifyGoogleUserMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(404)
  })

  it('parité D29 : exactement les quatre connecteurs', () => {
    expect(new Set(tombstonedConnectors())).toEqual(new Set(['gmail', 'drive', 'contacts', 'sheets']))
  })

  it("le corps du 410 est générique et uniforme (RÈGLE 6 — pas de leak)", async () => {
    const res = tombstoneResponse()
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'Gone' })
  })

  it("isConnectorTombstoned : parsing strict de la variable d'échappement", () => {
    for (const on of ['true', 'TRUE', ' 1 ', 'yes', 'on']) {
      expect(isConnectorTombstoned('gmail', { LEGACY_GOOGLE_CONNECTORS_ENABLED: on })).toBe(false)
    }
    for (const off of ['false', '', '0 pas vraiment', 'non']) {
      expect(isConnectorTombstoned('gmail', { LEGACY_GOOGLE_CONNECTORS_ENABLED: off })).toBe(true)
    }
    expect(isConnectorTombstoned('gmail', {})).toBe(true)
    expect(isConnectorTombstoned('gmail', undefined)).toBe(true)
    // Un connecteur hors liste n'est jamais tombstoné (calendar, etc.).
    expect(isConnectorTombstoned('calendar', {})).toBe(false)
  })
})
