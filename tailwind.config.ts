import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="nocturne"]'],
  theme: {
    extend: {
      colors: {
        cream: '#F5F0E8',
        accent: '#E05510',
        'bubble-user': '#1E1A14',

        ember: {
          paper: '#FAF3E7',
          ink: '#181613',
          muted: '#8F6B4D',
          accent: '#C85A28',
          card: '#FFFFFF',
          border: '#E8D9BF',
          cream: '#F5E6D0',
        },
        nocturne: {
          bg: '#0B0908',
          surface: '#181311',
          ink: '#F5E6D0',
          muted: '#A89C8A',
          accent: '#F59A4B',
          deep: '#2B1F15',
          border: 'rgba(245,154,75,0.08)',
        },

        theme: {
          bg: 'rgb(var(--theme-bg) / <alpha-value>)',
          surface: 'rgb(var(--theme-surface) / <alpha-value>)',
          ink: 'rgb(var(--theme-ink) / <alpha-value>)',
          muted: 'rgb(var(--theme-muted) / <alpha-value>)',
          accent: 'rgb(var(--theme-accent) / <alpha-value>)',
          border: 'rgb(var(--theme-border) / <alpha-value>)',
          cream: 'rgb(var(--theme-cream) / <alpha-value>)',
        },
      },
      fontFamily: {
        serif: ['Lora', 'serif'],
        display: ['Fraunces', 'Lora', 'serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        kicker: '0.2em',
      },
      borderRadius: {
        pill: '100px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'prism-left': {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '50%': { transform: 'translateX(-2px) rotate(-2deg)' },
        },
        'prism-right': {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '50%': { transform: 'translateX(2px) rotate(2deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'prism-left': 'prism-left 3.4s ease-in-out infinite',
        'prism-right': 'prism-right 3.4s ease-in-out infinite',
        'prism-left-active': 'prism-left 1.2s ease-in-out infinite',
        'prism-right-active': 'prism-right 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [typography],
} satisfies Config
