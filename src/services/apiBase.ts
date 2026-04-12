import { Capacitor } from '@capacitor/core'

/**
 * Returns the API base URL.
 * - On web: '' (same origin, relative paths work)
 * - On native: full Cloudflare Pages URL (since the app runs locally)
 */
const API_BASE = Capacitor.isNativePlatform()
  ? 'https://tryarty.com'
  : ''

/**
 * Build a full API URL from a relative path.
 * Usage: apiUrl('/api/ai/proxy') → 'https://tryarty.com/api/ai/proxy' (native)
 *                                → '/api/ai/proxy' (web)
 */
export function apiUrl(path: string): string {
  return API_BASE + path
}
