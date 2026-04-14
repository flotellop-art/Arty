/**
 * Google Sheets — append row or create spreadsheet (Feature 9).
 * Uses the user's Google token from the x-google-token header.
 */

export const onRequestPost: PagesFunction = async ({ request }) => {
  const token = request.headers.get('x-google-token') || request.headers.get('authorization')?.replace('Bearer ', '') || ''
  if (!token) return Response.json({ error: 'Missing Google token' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>
  const action = (body.action as string) || 'append'

  try {
    if (action === 'create') {
      return handleCreate(token, body)
    }
    if (action === 'append') {
      return handleAppend(token, body)
    }
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sheets action failed'
    return Response.json({ error: message }, { status: 500 })
  }
}

async function handleCreate(token: string, body: Record<string, unknown>): Promise<Response> {
  const title = (body.title as string) || 'Arty Export'
  const headers = (body.headers as string[] | undefined) || []

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title } }),
  })
  if (!createRes.ok) {
    const err = await createRes.text()
    return Response.json({ error: `Sheets create failed: ${err}` }, { status: createRes.status })
  }
  const sheet = await createRes.json() as { spreadsheetId?: string; spreadsheetUrl?: string }
  const spreadsheetId = sheet.spreadsheetId
  if (!spreadsheetId) {
    return Response.json({ error: 'No spreadsheetId returned' }, { status: 500 })
  }

  // Write headers to row 1 if provided
  if (headers.length > 0) {
    const valueInputOption = 'USER_ENTERED'
    const range = 'A1'
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [headers] }),
      }
    )
    if (!writeRes.ok) {
      const err = await writeRes.text()
      return Response.json({ error: `Header write failed: ${err}`, spreadsheetId }, { status: writeRes.status })
    }
  }

  return Response.json({
    spreadsheetId,
    url: sheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  })
}

async function handleAppend(token: string, body: Record<string, unknown>): Promise<Response> {
  const spreadsheetId = body.spreadsheetId as string
  const sheetName = (body.sheetName as string) || 'Feuille 1'
  const values = body.values as string[] | string[][] | undefined

  if (!spreadsheetId || !values) {
    return Response.json({ error: 'Missing spreadsheetId or values' }, { status: 400 })
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
    return Response.json({ error: 'Invalid spreadsheetId' }, { status: 400 })
  }

  // Normalize to [[...]]
  const rows = Array.isArray(values[0]) ? (values as string[][]) : [values as string[]]

  const range = encodeURIComponent(`${sheetName}!A1`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: `Append failed: ${err}` }, { status: res.status })
  }

  const data = await res.json() as { updates?: { updatedRange?: string; updatedRows?: number } }
  return Response.json({
    success: true,
    updatedRange: data.updates?.updatedRange || null,
    updatedRows: data.updates?.updatedRows || 0,
  })
}
