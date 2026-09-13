/** Standard global pricing, verified 2026-09-13 against OpenAI and Gemini
 * official pricing pages. The higher rate applies to the entire request.
 */
export function contextPricing<T extends { input: number; output: number; cacheRead?: number; cacheCreation?: number }>(
  model: string, rate: T, totalInputTokens: number,
): T {
  const openai = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'].includes(model)
  const pro = model === 'gemini-3.1-pro-preview'
  if ((!openai || totalInputTokens <= 272_000) && (!pro || totalInputTokens <= 200_000)) return rate
  if (!Number.isFinite(totalInputTokens)) return rate
  return {
    ...rate, input: rate.input * 2, output: rate.output * 1.5,
    ...(rate.cacheRead !== undefined ? { cacheRead: rate.cacheRead * 2 } : {}),
    ...(rate.cacheCreation !== undefined ? { cacheCreation: rate.cacheCreation * 2 } : {}),
  }
}
