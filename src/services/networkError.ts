// Browser transport errors do not tell us whether the server received a POST.
// Translate only known opaque messages; never use this to trigger a retry.
export function isFetchNetworkError(error: unknown): boolean {
  return error instanceof Error
    && /^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/i.test(error.message.trim())
}
