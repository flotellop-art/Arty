import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing access token' })

  const { type } = req.body as { type?: string }

  switch (type) {
    case 'search': return handleSearch(token, req, res)
    case 'create': return handleCreate(token, req, res)
    case 'update': return handleUpdate(token, req, res)
    default: return res.status(400).json({ error: 'Use type: search, create, or update' })
  }
}

async function handleSearch(token: string, req: VercelRequest, res: VercelResponse) {
  const { query } = req.body as { query?: string }
  const q = query || ''
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
      if (!r2.ok) { const err = await r2.json(); return res.status(r2.status).json({ error: err.error?.message }) }
      const data = await r2.json()
      const contacts = (data.connections || [])
        .filter((c: { names?: Array<{ displayName: string }> }) => {
          if (!q) return true
          const name = c.names?.[0]?.displayName?.toLowerCase() || ''
          return name.includes(q.toLowerCase())
        })
        .slice(0, 10)
        .map(formatContact)
      return res.status(200).json({ contacts })
    }
    const data = await r.json()
    const contacts = (data.results || []).map((r: { person: unknown }) => formatContact(r.person)).slice(0, 10)
    return res.status(200).json({ contacts })
  } catch { return res.status(500).json({ error: 'Search failed' }) }
}

async function handleCreate(token: string, req: VercelRequest, res: VercelResponse) {
  const { name, email, phone, company } = req.body as { name?: string; email?: string; phone?: string; company?: string }
  if (!name) return res.status(400).json({ error: 'Missing name' })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const person: any = { names: [{ givenName: name }] }
    if (email) person.emailAddresses = [{ value: email }]
    if (phone) person.phoneNumbers = [{ value: phone }]
    if (company) person.organizations = [{ name: company }]

    const r = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(person),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ success: true, name, resourceName: result.resourceName })
  } catch { return res.status(500).json({ error: 'Create failed' }) }
}

async function handleUpdate(token: string, req: VercelRequest, res: VercelResponse) {
  const { resourceName, email, phone } = req.body as { resourceName?: string; email?: string; phone?: string }
  if (!resourceName) return res.status(400).json({ error: 'Missing resourceName' })

  try {
    // Get current contact first
    const getRes = await fetch(
      `https://people.googleapis.com/v1/${resourceName}?personFields=names,emailAddresses,phoneNumbers`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!getRes.ok) return res.status(getRes.status).json({ error: 'Contact not found' })
    const current = await getRes.json()

    const updateMask: string[] = []
    if (email) { current.emailAddresses = [{ value: email }]; updateMask.push('emailAddresses') }
    if (phone) { current.phoneNumbers = [{ value: phone }]; updateMask.push('phoneNumbers') }

    const r = await fetch(
      `https://people.googleapis.com/v1/${resourceName}:updateContact?updatePersonFields=${updateMask.join(',')}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Update failed' }) }
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
