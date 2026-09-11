// Google pricing, verified 2026-09-11:
// https://ai.google.dev/gemini-api/docs/pricing
// Introductory rates through 2026-12-31; no redeploy needed at expiry.
export function gemini38Pricing(now = Date.now()) {
  return now < Date.UTC(2027, 0, 1)
    ? { input: 0.75, output: 3.75, cacheRead: 0.075, groundingPerQuery: 14 / 1000 }
    : { input: 1.5, output: 7.5, cacheRead: 0.15, groundingPerQuery: 14 / 1000 }
}
