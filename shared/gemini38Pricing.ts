/** Official standard API rates; introductory pricing expires automatically. */
export function gemini38Pricing(now = Date.now()) {
  const factor = now < Date.UTC(2027, 0, 1) ? 0.5 : 1
  return { input: 1.5 * factor, output: 7.5 * factor, cacheRead: 0.15 * factor, groundingPerQuery: 14 / 1000 }
}
