/**
 * Safe JSON parser for fetch responses.
 * When a Vercel function crashes, it returns plain text ("A server error occurred")
 * instead of JSON. This helper catches that and throws a user-friendly error.
 */
export async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      res.ok
        ? 'Réponse invalide du serveur. Réessaie.'
        : `Erreur serveur (${res.status}). Réessaie dans un instant.`
    )
  }
}
