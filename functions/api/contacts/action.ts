import type { Env } from '../../env'
import { verifyGoogleUser, notFoundResponse } from '../_lib/checkAllowedUser'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // CRIT-4 (audit étape 2) — exiger un user Google identifié.
  const email = await verifyGoogleUser(request, env)
  if (!email) return notFoundResponse()

  const token = request.headers.get('authorization')?.replace('Bearer ', '') || ''
  if (!token) return notFoundResponse()

  const body = await request.json() as Record<string, unknown>
  // H-Back-5 — borner la taille de query pour éviter l'amplification People API.
  if (typeof body.query === 'string' && body.query.length > 500) {
    return Response.json({ error: 'Query too long (max 500)' }, { status: 400 })
  }
  const type = body.type as string | undefined

  switch (type) {
    case 'search': return handleSearch(token, body)
    case 'create': return handleCreate(token, body)
    case 'update': return handleUpdate(token, body)
    default: return Response.json({ error: 'Use type: search, create, update' }, { status: 400 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatContact(person: any) {
  return {
    resourceName: person.resourceName || '',
    name: person.names?.[0]?.displayName || '(sans nom)',
    email: person.emailAddresses?.[0]?.value || '',
    phone: person.phoneNumbers?.[0]?.value || '',
    company: person.organizations?.[0]?.name || '',
  }
}

async function handleSearch(token: string, body: Record<string, unknown>): Promise<Response> {
  const q = (body.query as string) || ''
  try {
    const r = await fetch(
      `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(q)}&readMask=names,emailAddresses,phoneNumbers,organizations&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) {
      // Fallback to connections list
      const r2 = await fetch(
        `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations&pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!r2.ok) { const err = await r2.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r2.status }) }
      const data = await r2.json() as { connections?: Array<Record<string, unknown>> }
      const contacts = (data.connections || [])
        .filter((c) => {
          if (!q) return true
          const name = ((c.names as Array<{ displayName: string }>)?.[0]?.displayName || '').toLowerCase()
          return name.includes(q.toLowerCase())
        })
        .slice(0, 10)
        .map(formatContact)
      return Response.json({ contacts })
    }
    const data = await r.json() as { results?: Array<{ person: unknown }> }
    const contacts = (data.results || []).map((r) => formatContact(r.person)).slice(0, 10)
    return Response.json({ contacts })
  } catch { return Response.json({ error: 'Search failed' }, { status: 500 }) }
}

async function handleCreate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { name, email, phone, company } = body as { name?: string; email?: string; phone?: string; company?: string }
  if (!name) return Response.json({ error: 'Missing name' }, { status: 400 })

  try {
    const person: Record<string, unknown> = { names: [{ givenName: name }] }
    if (email) person.emailAddresses = [{ value: email }]
    if (phone) person.phoneNumbers = [{ value: phone }]
    if (company) person.organizations = [{ name: company }]

    const r = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(person),
    })
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const result = await r.json() as Record<string, unknown>
    return Response.json({ success: true, name, resourceName: result.resourceName })
  } catch { return Response.json({ error: 'Create failed' }, { status: 500 }) }
}

async function handleUpdate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { resourceName, email, phone } = body as { resourceName?: string; email?: string; phone?: string }
  if (!resourceName) return Response.json({ error: 'Missing resourceName' }, { status: 400 })
  // BUG 32 — valider le resourceName (forme `people/c123`) avant de l'injecter
  // dans l'URL People API. Sans ça, un `?`/`#`/`/` réécrit le path/query de
  // l'appel Google (path/query injection vers l'API).
  if (!/^people\/[a-zA-Z0-9_-]+$/.test(resourceName)) {
    return Response.json({ error: 'Invalid resourceName' }, { status: 400 })
  }

  try {
    const getRes = await fetch(
      `https://people.googleapis.com/v1/${resourceName}?personFields=names,emailAddresses,phoneNumbers`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!getRes.ok) return Response.json({ error: 'Contact not found' }, { status: getRes.status })
    const current = await getRes.json() as Record<string, unknown>

    const updateMask: string[] = []
    if (email) { current.emailAddresses = [{ value: email }]; updateMask.push('emailAddresses') }
    if (phone) { current.phoneNumbers = [{ value: phone }]; updateMask.push('phoneNumbers') }

    const r = await fetch(
      `https://people.googleapis.com/v1/${resourceName}:updateContact?updatePersonFields=${updateMask.join(',')}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(current) }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Update failed' }, { status: 500 }) }
}
