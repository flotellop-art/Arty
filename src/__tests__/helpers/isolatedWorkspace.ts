import { openDB } from 'idb'
import { isolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'

export const GENERATION = '76ba201a-547f-44a1-9000-111111111111'
export const isolatedControl = (requiredOwners: (string | null)[] = []) => ({
  format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', revision: 1, state: 'ready', generation: GENERATION, requiredOwners,
})
// Synthetic fixture only, NOT a migration implementation or production writer.
export async function seedIsolatedWorkspace(requiredOwners: (string | null)[] = []) {
  const layout = isolatedWorkspaceLayout(GENERATION, requiredOwners)
  for (const [name, version] of [['arty-files', 2], [layout.files.name, 1]] as const) {
    const db = await openDB(name, version, { upgrade(db) {
      db.createObjectStore('files', { keyPath: 'fileId' }).createIndex('ownerKey', 'ownerKey')
    } }); db.close()
  }
  for (const [name, version] of [['arty-projects', 2], [layout.projects.name, 1]] as const) {
    const db = await openDB(name, version, { upgrade(db) {
      const projects = db.createObjectStore('projects', { keyPath: 'key' })
      projects.createIndex('owner', 'owner'); projects.createIndex('owner-state', ['owner', 'state'])
      const docs = db.createObjectStore('documents', { keyPath: 'key' })
      docs.createIndex('owner', 'owner'); docs.createIndex('owner-project', ['owner', 'projectId'])
      docs.createIndex('owner-state-kind', ['owner', 'state', 'kind'])
      docs.createIndex('owner-state-kind-bytes', ['owner', 'state', 'kind', 'sourceBytes'])
      db.createObjectStore('usage', { keyPath: 'owner' }); db.createObjectStore('meta')
    } }); db.close()
  }
  const db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
  await db.put('meta', isolatedControl(requiredOwners), 'workspace'); db.close()
  return layout
}
