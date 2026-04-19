# Theme system — Ember (day) & Nocturne (night)

This document describes the theme tokens, the `themeService`, and the
`PrismMark` brand component introduced in PR1 of the design refresh.
PR2 (Home + Login) and PR3 (Chat + Sidebar + Brief + Tasks + Report +
Settings) build on top of these primitives.

Source spec: `design_handoff_arty/README.md` and `direction-ember.jsx` /
`direction-nocturne.jsx`.

## TL;DR

- Two themes: **Ember** (warm daylight) and **Nocturne** (candle-lit night).
- The active theme is set by `<html data-theme="ember"|"nocturne">`.
- Components consume tokens via Tailwind `theme-*` utilities — never hex.
- The brand mark is `<PrismMark />` (and `<ArtyWordmark />` for headers).

## Tokens

Defined in `src/index.css` as RGB channels (so Tailwind `<alpha-value>`
works) and exposed in `tailwind.config.ts` as the `theme.*` color family.

| Token             | Tailwind class           | Ember     | Nocturne                |
| ----------------- | ------------------------ | --------- | ----------------------- |
| Page background   | `bg-theme-bg`            | `#FAF3E7` | `#0B0908`               |
| Card / surface    | `bg-theme-surface`       | `#FFFFFF` | `#181311`               |
| Primary text      | `text-theme-ink`         | `#181613` | `#F5E6D0`               |
| Muted text        | `text-theme-muted`       | `#8F6B4D` | `#A89C8A`               |
| Brand accent      | `text-theme-accent`      | `#C85A28` | `#F59A4B`               |
| Hairline border   | `border-theme-border`    | `#E8D9BF` | `#F59A4B` @ 8% opacity  |
| Alt warm surface  | `bg-theme-cream`         | `#F5E6D0` | `#2B1F15`               |

Use opacity modifiers, e.g. `bg-theme-accent/10` for a subtle tint.

The raw palettes are also still available as `ember.*` and `nocturne.*`
classes if you ever need a single-mode hex (rare — prefer `theme.*`).

## Typography

Three families loaded in `index.html`:

- **Fraunces** — `font-display` — headlines and the wordmark (italic 400).
- **Inter** — `font-sans` — UI, body, buttons (default).
- **JetBrains Mono** — `font-mono` — kickers, timestamps, metadata.

Suggested scale (keep editorial feel, do not compress):

```
display    text-5xl  font-display font-light  tracking-tight
h1         text-3xl  font-display font-normal tracking-tight
h2         text-2xl  font-display italic
body-lg    text-base font-sans
body       text-sm   font-sans font-medium
small      text-xs   font-sans
kicker     text-[11px] font-sans font-semibold uppercase tracking-kicker
mono       text-[11px] font-mono
```

## Usage

```tsx
import { PrismMark, ArtyWordmark } from '../shared/PrismMark'

// In a screen
<div className="bg-theme-bg text-theme-ink min-h-screen">
  <header className="flex items-center justify-between px-6 py-4">
    <ArtyWordmark size={22} />
    <button className="text-theme-muted">FR</button>
  </header>

  <p className="font-mono text-[11px] uppercase tracking-kicker text-theme-muted">
    Mercredi 9h12
  </p>
  <h1 className="font-display text-3xl text-theme-ink leading-tight">
    Tu as <em className="text-theme-accent">trois choses</em> à regarder ce matin.
  </h1>

  <article className="rounded-[14px] border border-theme-border bg-theme-surface p-4">
    …
  </article>
</div>
```

The listening Prism (voice activation):

```tsx
<PrismMark size={22} color="#F59A4B" fill active />
```

## ThemeService API

```ts
import {
  getTheme,            // → 'ember' | 'nocturne' (resolved, follows auto)
  getMode,             // → 'ember' | 'nocturne' | 'auto'
  setMode,             // (mode) → resolved Theme, persists + applies
  toggleTheme,         // flips ember ↔ nocturne, sets explicit mode
  applyTheme,          // (theme) → side-effect only (sets data-theme)
  startThemeWatcher,   // boots + auto-rechecks the clock; returns cleanup
  isNightTime,         // pure helper, true between 19h and 7h local
} from '../services/themeService'
```

`startThemeWatcher()` is mounted from `App.tsx` once the user is
authenticated. Components never need to call `applyTheme` directly —
just `setMode('auto' | 'ember' | 'nocturne')` or `toggleTheme()` and
listen to the `theme-changed` window event if local UI needs to react.

```ts
useEffect(() => {
  const onChange = (e: Event) => {
    const { theme } = (e as CustomEvent<{ theme: 'ember' | 'nocturne' }>).detail
    // …
  }
  window.addEventListener('theme-changed', onChange)
  return () => window.removeEventListener('theme-changed', onChange)
}, [])
```

## Migration plan (PR2/PR3)

The legacy `html.dark` overrides in `index.css` are kept so the existing
screens keep working during the migration. As each screen is rewritten:

1. Replace hardcoded hex / `bg-cream` / `bg-white` with `bg-theme-*`.
2. Swap the AnimatedStar for `<PrismMark fill />` (size 22 in headers,
   80 on the home hero).
3. Adopt `font-display` for headlines, `font-mono` + `tracking-kicker`
   for the small uppercase kickers (e.g. `MERCREDI 9H12 · VALENCE`).
4. Once every screen is migrated, the `html.dark` block at the top of
   `src/index.css` can be deleted.
