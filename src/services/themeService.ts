/**
 * Theme service — Ember (day) / Nocturne (night).
 *
 * Source of truth: `<html data-theme="ember"|"nocturne">`.
 *
 * Tokens live in `src/index.css` under :root (Ember default) and
 * `html[data-theme="nocturne"]`. Components consume them via Tailwind
 * `theme-*` utilities (see `tailwind.config.ts`) or `var(--theme-*)`.
 *
 * Modes:
 *   - 'ember'   : day theme (forced)
 *   - 'nocturne': night theme (forced)
 *   - 'auto'    : ember between 07:00–19:00, nocturne otherwise
 *
 * Legacy 'light'/'dark' values are accepted on read for back-compat
 * with the previous theme service and mapped to ember/nocturne.
 */

import * as scoped from './scopedStorage'

const KEY = 'theme'
const DAY_START_HOUR = 7
const NIGHT_START_HOUR = 19

export type Theme = 'ember' | 'nocturne'
export type ThemeMode = Theme | 'auto'

export function isNightTime(now: Date = new Date()): boolean {
  const h = now.getHours()
  return h < DAY_START_HOUR || h >= NIGHT_START_HOUR
}

function fromAuto(): Theme {
  return isNightTime() ? 'nocturne' : 'ember'
}

export function getMode(): ThemeMode {
  const stored = scoped.getItem(KEY)
  if (stored === 'ember' || stored === 'nocturne' || stored === 'auto') return stored
  // Legacy values from the old light/dark service.
  if (stored === 'dark') return 'nocturne'
  if (stored === 'light') return 'ember'
  return 'auto'
}

export function getTheme(): Theme {
  const mode = getMode()
  return mode === 'auto' ? fromAuto() : mode
}

export function setMode(mode: ThemeMode): Theme {
  scoped.setItem(KEY, mode)
  const resolved = mode === 'auto' ? fromAuto() : mode
  applyTheme(resolved)
  window.dispatchEvent(
    new CustomEvent('theme-changed', { detail: { mode, theme: resolved } })
  )
  return resolved
}

export function setTheme(theme: Theme): void {
  setMode(theme)
}

export function applyTheme(theme: Theme): void {
  const el = document.documentElement
  el.setAttribute('data-theme', theme)
  // Keep the legacy `dark` class in sync for any old code paths.
  if (theme === 'nocturne') el.classList.add('dark')
  else el.classList.remove('dark')

  // Reflect in <meta name="theme-color"> so the Android system bar matches.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = theme === 'nocturne' ? '#201D19' : '#F4EFE5'
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'nocturne' ? 'ember' : 'nocturne'
  setMode(next)
  return next
}

/**
 * Boots the theme: applies the resolved theme, and (when in auto)
 * re-evaluates on `visibilitychange` and once per minute so the app
 * follows the clock without a reload.
 *
 * Returns a cleanup function for React effects.
 */
export function startThemeWatcher(): () => void {
  applyTheme(getTheme())

  const reevaluate = () => {
    if (getMode() !== 'auto') return
    const next = fromAuto()
    if (document.documentElement.getAttribute('data-theme') !== next) {
      applyTheme(next)
      window.dispatchEvent(
        new CustomEvent('theme-changed', { detail: { mode: 'auto', theme: next } })
      )
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') reevaluate()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const interval = window.setInterval(reevaluate, 60_000)

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.clearInterval(interval)
  }
}
