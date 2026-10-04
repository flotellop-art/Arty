import { isSafePublicUrl } from '../../../functions/api/_lib/urlSafety'

export interface ReaderProfile { hosts: string[]; resources: string[] }
export function profilesFromConfig(raw: string): ReaderProfile[] {
  const profiles: unknown = JSON.parse(raw)
  if (!Array.isArray(profiles) || profiles.length > 50) throw new Error('policy_unavailable')
  return profiles.map((p: ReaderProfile) => {
    if (!Array.isArray(p.hosts) || !p.hosts.length || !Array.isArray(p.resources)) throw new Error('policy_unavailable')
    const hosts = [...new Set([...p.hosts, ...p.resources])]
    if (hosts.length > 50 || hosts.some(h => typeof h !== 'string' || h !== h.toLowerCase()
      || !/^[a-z0-9.-]+$/.test(h) || h.endsWith('.') || !isSafePublicUrl(new URL(`https://${h}/`)))) {
      throw new Error('policy_unavailable')
    }
    return { hosts: p.hosts, resources: hosts }
  })
}

export function profileFor(url: URL, profiles: ReaderProfile[]): ReaderProfile | undefined {
  if (url.protocol !== 'https:' || !isSafePublicUrl(url) || url.hostname.endsWith('.')) return undefined
  return profiles.find(p => p.hosts.includes(url.hostname))
}

export function permitsRequest(profile: ReaderProfile, raw: string, method: string, type: string, navigation: boolean): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && isSafePublicUrl(url) && !url.hostname.endsWith('.')
      && ['GET', 'HEAD'].includes(method)
      && ['document', 'script', 'stylesheet', 'xhr', 'fetch', 'other'].includes(type)
      && (navigation ? profile.hosts : profile.resources).includes(url.hostname)
  } catch { return false }
}
