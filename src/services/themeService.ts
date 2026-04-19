/**
 * Theme service — Day (Ember) / Night (Nocturne) with an optional "auto"
 * mode driven by local time. The user picks a preference (light / dark /
 * auto) and we resolve it to an effective Theme and apply it to the DOM.
 */

import * as scoped from './scopedStorage'

const KEY = 'theme-pref'
const LEGACY_KEY = 'theme'

export type Theme = 'light' | 'dark'
export type ThemePreference = 'light' | 'dark' | 'auto'

// Night runs from DAY_END until DAY_START the next morning.
const DAY_START = 7
const DAY_END = 19

export function getPreference(): ThemePreference {
  const v = scoped.getItem(KEY)
  if (v === 'light' || v === 'dark' || v === 'auto') return v
  // Migrate from the legacy 'theme' key (light/dark only).
  const legacy = scoped.getItem(LEGACY_KEY)
  return legacy === 'dark' ? 'dark' : 'light'
}

export function resolveTheme(pref: ThemePreference = getPreference()): Theme {
  if (pref !== 'auto') return pref
  const h = new Date().getHours()
  return h >= DAY_START && h < DAY_END ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  const el = document.documentElement
  if (theme === 'dark') el.classList.add('dark')
  else el.classList.remove('dark')
}

export function setPreference(pref: ThemePreference): Theme {
  scoped.setItem(KEY, pref)
  const theme = resolveTheme(pref)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { preference: pref, theme } }))
  return theme
}

export function getTheme(): Theme {
  return resolveTheme()
}

export function setTheme(theme: Theme): Theme {
  return setPreference(theme)
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  return setPreference(next)
}

// Re-evaluate the active theme every minute so the auto mode flips at
// 07:00 and 19:00 without needing a reload.
let watchHandle: ReturnType<typeof setInterval> | null = null
export function startAutoThemeWatcher(): () => void {
  if (watchHandle) return () => {}
  watchHandle = setInterval(() => {
    if (getPreference() !== 'auto') return
    applyTheme(resolveTheme('auto'))
  }, 60_000)
  return () => {
    if (watchHandle) clearInterval(watchHandle)
    watchHandle = null
  }
}
