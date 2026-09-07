import { expect, it } from 'vitest'
import { createSyncIdentityInventory } from '../../services/workspaceSync/occupiedIdentities'

it('inventories whole history strings and compound/string keys across owners without truncation', () => {
  const ids = createSyncIdentityInventory(), repeated = { id: 'message-id' }
  ids.inspect([{ id: 'chat-id', messages: [repeated, repeated], metadata: { reference: 'reserved-answer' } }])
  ids.inspectRow('file-key', { fileId: 'file-id' })
  ids.inspectRow(['other-owner', 'compound-key'], { id: 'project-id', projectId: 'parent' })
  for (const id of ['chat-id', 'message-id', 'reserved-answer', 'file-key', 'file-id', 'other-owner', 'compound-key', 'project-id', 'parent']) expect(ids.has(id)).toBe(true)
  expect(ids.has('free')).toBe(false)
})
it.each(['rows', 'identities', 'characters', 'empty-visits'])('fails closed on cumulative %s, including primitive keys and repeats', kind => {
  const ids = createSyncIdentityInventory()
  if (kind === 'rows') for (let i = 0; i < 100_000; i++) ids.inspectRow('', {})
  if (kind === 'identities') for (let i = 0; i < 100_000; i++) ids.inspect(`id-${i}`)
  if (kind === 'characters') { const s = 'x'.repeat(1024 * 1024); for (let i = 0; i < 32; i++) ids.inspect(s) }
  if (kind === 'empty-visits') for (let i = 0; i < 1_000_000; i++) ids.inspect('')
  expect(() => kind === 'rows' ? ids.inspectRow('', {}) : ids.inspect('one-too-many')).toThrow('limit')
  expect(() => ids.has('could-be-a-collision')).toThrow('limit')
})
