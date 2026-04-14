/**
 * Theme service — light/dark mode (Feature 10).
 */

import * as scoped from './scopedStorage'

const KEY = 'theme'

export type Theme = 'light' | 'dark'

export function getTheme(): Theme {
  const stored = scoped.getItem(KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  scoped.setItem(KEY, theme)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }))
}

export function applyTheme(theme: Theme): void {
  const el = document.documentElement
  if (theme === 'dark') el.classList.add('dark')
  else el.classList.remove('dark')
}

export function toggleTheme(): Theme {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
