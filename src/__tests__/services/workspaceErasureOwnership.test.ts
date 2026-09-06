import { beforeEach, expect, it } from 'vitest'
import { parseOwnedLocalKey } from '../../services/workspaceWriter/localOwnership'
import { erasureLocalSnapshot } from '../../services/workspaceWriter/erasureInventory'
import { assertNativeErasureOwner } from '../../services/native/coldMailErasure'
import { GENERATION } from '../helpers/isolatedWorkspace'

beforeEach(() => localStorage.clear())
it.each(['a', 'a-b', 'a:b', 'é', '𝄞', 'null', 'anon'])('exact opaque owner %s', async owner => {
  localStorage.setItem(`arty-${owner}-theme`, 'own')
  localStorage.setItem(`arty-composer-draft:${owner}:home`, 'draft')
  localStorage.setItem('arty-neighbour-theme', 'B')
  localStorage.setItem(`arty-${owner}-product-measurement-v1`, 'own-consent')
  localStorage.setItem('arty-neighbour-product-measurement-v1', 'neighbor-consent')
  const snapshot = await erasureLocalSnapshot(GENERATION, owner)
  expect(snapshot.changes).toEqual(expect.arrayContaining([[`arty-${owner}-theme`, null], [`arty-composer-draft:${owner}:home`, null]]))
  expect(snapshot.changes).not.toContainEqual(['arty-neighbour-theme', null])
  expect(snapshot.changes).toContainEqual([`arty-${owner}-product-measurement-v1`, null])
  expect(snapshot.changes).not.toContainEqual(['arty-neighbour-product-measurement-v1', null])
})
it.each(['arty-a-report-conversations', 'arty-a-report-theme', 'arty-composer-draft:anonymous:home', 'arty-composer-draft:a:conversation:home', 'arty-composer-draft:a:conversation:old-id'])('refuses ambiguous/unsupported %s', key => {
  expect(() => parseOwnedLocalKey(key)).toThrow()
})
it('Google A sharing the Email B address never owns B login hash', async () => {
  const email = 'same@example.test', hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
  const id = Array.from(new Uint8Array(hash).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('')
  const key = `arty-email-hash-${email}`
  localStorage.setItem(key, 'synthetic-password-hash')
  localStorage.setItem('arty-known-sessions', JSON.stringify([{ userId: `google-${id}`, email }, { userId: `email-${id}`, email, extra: 'B' }]))
  expect((await erasureLocalSnapshot(GENERATION, `google-${id}`)).changes).not.toContainEqual([key, null])
  expect((await erasureLocalSnapshot(GENERATION, `email-${id}`)).changes).toContainEqual([key, null])
})
it('refuses lone surrogates without normalizing valid Unicode owners', () => {
  for (const owner of ['\ud800', '\udc00', 'a\ud800b']) expect(() => assertNativeErasureOwner(owner)).toThrow()
  for (const owner of ['é', 'e\u0301', '𝄞', 'a:b']) expect(() => assertNativeErasureOwner(owner)).not.toThrow()
})
