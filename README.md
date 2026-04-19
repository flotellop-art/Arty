# Handoff — Arty (Day & Night)

## Overview

**Arty** is a personal AI assistant mobile app (Android-first, French/English bilingual). The app pairs two distinct visual moods on a single brand foundation: **Ember** (warm editorial daylight) and **Nocturne** (candle-lit night). Both directions share the same content model and information architecture; only the palette, type treatment, and micro-ornaments differ. The app switches between them automatically at 19h00 (or manually via toggle).

The flagship feature is the **Prism** brand mark — a two-triangle geometric symbol representing refraction / dual-mode, used at every scale from 12px favicon to 160px splash.

## About the Design Files

The files in this bundle are **design references created in HTML/React** — prototypes showing intended look and behavior, not production code to copy directly. The HTML uses Babel-transpiled JSX in the browser for rapid iteration.

**Your task**: Recreate these designs in the target codebase's environment (React Native, Flutter, SwiftUI, Jetpack Compose, or whatever the existing mobile stack is) using its established patterns and libraries. If no codebase exists yet, choose the most appropriate mobile framework and implement the designs there.

## Fidelity

**High-fidelity.** All colors, typography, spacing, and interactions are final. Recreate pixel-perfectly using the codebase's existing component libraries.

## The Prism Brand Mark

The defining visual element. Two triangles meeting at a shared apex, the left half rendered at reduced opacity.

**SVG construction (64×64 viewBox):**
```
<path d="M32 6 L58 54 L32 40 Z" fill="{color}" />
<path d="M32 6 L6 54 L32 40 Z" fill="{color}" opacity="0.55" />
```

**Coordinates:**
- Apex: `(32, 6)`
- Base right: `(58, 54)`
- Base left: `(6, 54)`
- Seam (where halves meet): `(32, 40)` — 5/8 of the way down
- Left-half opacity: `0.55`
- Right-half opacity: `1.0`

**Outline variant** (for app bars, small UI): same geometry, `fill="none"`, stroke equal to `max(1.4, size/16)`.

**Animation:**
- **Idle**: Each half breathes horizontally with a slight rotation. `3.4s` ease-in-out infinite, alternating. Left half shifts `-2px` and rotates `-2deg`; right half shifts `+2px` and rotates `+2deg`.
- **Active (listening)**: Same animation but `1.2s` duration, plus `drop-shadow(0 0 8px rgba(245,154,75,0.4))` filter.
- See `Arty - Prism system.html` for the full animation spec.

## Screens / Views

The app has **8 screens** in a single-user flow:

1. **Login** — email/magic-link entry, Google sign-in
2. **Home** — morning/evening dashboard with card stack, voice input bar pinned bottom
3. **Chat** — conversational thread with Arty, text + voice input
4. **Sidebar** — navigation drawer (slides over home)
5. **Brief** — daily summary view, editorial layout with large serif headline
6. **Tasks** — to-do list with completion, priority, due dates
7. **Report** — long-form generated document (meeting recap, article, etc.)
8. **Settings** — profile, connected accounts, preferences

All screens work in both **Ember** (day) and **Nocturne** (night). Navigation is flat (sidebar → any screen), except Login which is a gate.

### Screen specs

Each screen's exact layout, spacing, copy, and component positioning is captured in the direction JSX files:
- `direction-ember.jsx` — all 8 screens in Ember
- `direction-nocturne.jsx` — all 8 screens in Nocturne

Read those files for pixel-level detail. Summary follows.

### Home screen (most important)

**Ember (day):**
- Header: Prism mark (22px, `#C85A28`) + "arty" wordmark in Fraunces italic 26px, avatar pill right
- Kicker: "Mercredi 9h12" — `11px`, letter-spacing `0.2em`, uppercase, `#8F6B4D`
- Headline: Fraunces 28px weight 400, `#181613`, line-height 1.15; accent words in `#C85A28` italic. Copy: "Tu as *trois choses* à regarder ce matin."
- Card stack: 3 cards, white bg, `14px` radius, `1px solid #E8D9BF` border, padding `14px 16px`. Each card = title (13px semibold) + subtitle (11px `#8F6B4D`).
- Input bar (pinned bottom, 24px from edges): `#181613` bg, fully rounded, `14px 22px` padding, Prism mark 22px `#F59A4B`, "Demande quelque chose…" placeholder 12px `#F5E6D0`.

**Nocturne (night):**
- Same structure, inverted palette: `#0B0908` bg, `#F5E6D0` text, `#F59A4B` accents
- Card border: `1px solid rgba(245,154,75,0.08)`, card bg `#181311`
- Input bar: `#F59A4B` bg (terracotta), `#0B0908` text — the CTA inverts from day (dark input) to night (bright input)

## Interactions & Behavior

- **Screen routing**: sidebar drawer slides in from left, 280px wide, 300ms ease
- **Mode toggle**: physical knob switch (top-right in Tweaks panel during design review; in the real app this should be a Settings toggle + auto at 19h00)
- **Voice activation**: tapping the input bar or saying "Hey Arty" triggers the Prism listening animation (1.2s cycle + amber glow); a pulsing ring expands from the logo
- **Language**: FR/EN toggle. All copy keys live in `data.jsx` under `window.COPY.fr` and `window.COPY.en`.
- **Auto day/night**: check local time on app resume; switch theme when crossing 19h00 / 07h00 thresholds
- **Card tap**: navigates to detail (brief → open full brief, email → open thread, pomodoro → start timer)

## State Management

- `mode` — `'day' | 'night'` (derived from clock, overridable by user)
- `lang` — `'fr' | 'en'`
- `screen` — current screen key (`'login' | 'home' | ...`)
- `sidebarOpen` — boolean
- `voiceActive` — boolean (drives Prism animation state)
- `user` — profile object
- Persisted in localStorage under `artyv2.*` keys (see `Arty v2 - Day_Night.html` line 186)

## Design Tokens

### Colors

**Ember (day):**
```
--ember-paper:    #FAF3E7   /* page background */
--ember-ink:      #181613   /* primary text */
--ember-muted:    #8F6B4D   /* secondary text, kickers */
--ember-accent:   #C85A28   /* brand terracotta, headlines accent */
--ember-card:     #FFFFFF   /* card bg */
--ember-border:   #E8D9BF   /* card borders, hairlines */
--ember-cream:    #F5E6D0   /* alt surface */
```

**Nocturne (night):**
```
--nocturne-bg:       #0B0908   /* page background */
--nocturne-surface:  #181311   /* card bg */
--nocturne-ink:      #F5E6D0   /* primary text */
--nocturne-muted:    #A89C8A   /* secondary text */
--nocturne-accent:   #F59A4B   /* brand amber, CTAs */
--nocturne-deep:     #2B1F15   /* bronze surface */
--nocturne-border:   rgba(245,154,75,0.08)
```

**Shared:**
```
--warm-gradient: linear-gradient(145deg, #F59A4B 0%, #C4491C 100%)   /* hero moments */
```

### Typography

- **Primary serif**: `Fraunces` (Google Fonts). Used for headlines and the wordmark (italic 400). Axes: italic 0..1, weight 300..700.
- **Primary sans**: `Inter`. Used for UI, body, buttons. Weights 400/500/600/700/800.
- **Mono**: `JetBrains Mono`. Used for timestamps, kickers, metadata.

**Scale:**
```
display:       56px  Fraunces  300  line-height 0.95  letter-spacing -0.03em
h1:            28-34px  Fraunces  400  line-height 1.15  letter-spacing -0.02em
h2:            22-26px  Fraunces italic  400/500
body-large:    15-16px  Inter  400  line-height 1.6
body:          13px  Inter  500/600
small:         11-12px  Inter  400/500
kicker:        10-11px  Inter  600  letter-spacing 0.2em  uppercase
mono:          10-11px  JetBrains Mono  400/500
```

### Spacing

Based on 4px unit. Common values: `4, 8, 10, 12, 14, 18, 22, 28, 32, 40`.

### Radii

```
input-pill:    100px (fully rounded)
card:          14px
large-card:    18-20px
phone-bezel:   36px (inner) / 42px (outer)
app-icon:      20-24px
```

### Shadows

```
phone-shadow:  0 40px 80px -20px rgba(40,20,10,0.35), 0 8px 20px rgba(40,20,10,0.1)
app-icon:      0 6-8px 20-24px rgba(0,0,0,0.3-0.35)
listening-ring: box-shadow 0 0 0 {0→14-16px} rgba(245,154,75,{0.5→0}) keyframed
```

## Assets

- **Fraunces, Inter, JetBrains Mono** — Google Fonts, loaded via `<link>` preconnect + `fonts.googleapis.com/css2?family=…`
- **Prism mark** — SVG defined inline (see above), no external asset
- **No raster imagery** in current design. Placeholder component (`Placeholder` in `shared.jsx`) used for image slots — replace with real avatars/illustrations per product spec.

## Files in this bundle

- `Arty v2 - Day_Night.html` — the main app prototype with day/night switching, all 8 screens × 2 directions
- `Arty - Prism system.html` — brand mark system reference (construction, scales, colors, lockups, app icons, in-context phone mockups)
- `shared.jsx` — `Star` (Prism mark), `Placeholder`, `PhoneFrame`, `StatusBar`, `useT`, `SCREENS` constant
- `data.jsx` — `window.COPY.fr` and `window.COPY.en` — **all app copy lives here**; use as your i18n source of truth
- `direction-ember.jsx` — all 8 screens implemented in Ember
- `direction-nocturne.jsx` — all 8 screens implemented in Nocturne
- `android-frame.jsx` — Android device bezel with status bar + nav bar (reference only; use platform native chrome)

## Implementation notes

1. **Start with the Prism mark** — build it as a reusable component with `size`, `color`, `fill`, and `active` props. Then build the wordmark lockup (Prism + "arty" in Fraunces italic).
2. **Build the theme provider next** — Ember and Nocturne should be a single theme context with token names that map to different values per mode. Screen code should only reference semantic tokens (`theme.accent`, `theme.surface`), never hex values.
3. **Copy the French strings verbatim** from `data.jsx`. This is the primary market. English is equivalent; do not ship it as the default.
4. **The editorial feel is load-bearing.** Wide margins, large serif italic headlines, short lines (max ~40 chars), deliberate whitespace. Do not compress.
5. **Voice input is central.** The bottom bar must always be reachable; the Prism mark inside it animates during listening. Listening state should be global, not per-screen.
