import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy (gardés pour compat les composants non refondus)
        cream: '#F5F0E8',
        accent: '#E05510',
        'bubble-user': '#1E1A14',

        // Arty v2 — Ember (jour) + Nocturne (nuit) via CSS vars qui flippent sur html.dark
        paper: 'var(--arty-bg)',
        'paper-deep': 'var(--arty-bg-deep)',
        ink: 'var(--arty-ink)',
        'ink-soft': 'var(--arty-ink-soft)',
        muted: 'var(--arty-muted)',
        card: 'var(--arty-card)',
        'card-hi': 'var(--arty-card-hi)',
        line: 'var(--arty-line)',
        ember: 'var(--arty-accent)',
        'ember-deep': 'var(--arty-accent-deep)',
      },
      fontFamily: {
        display: ['Fraunces', 'Lora', 'Georgia', 'serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [typography],
} satisfies Config
