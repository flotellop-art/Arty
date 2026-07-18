import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="nocturne"]'],
  theme: {
    extend: {
      colors: {
        cream: '#F4EFE5',
        accent: '#C45E44',
        'bubble-user': '#201D19',

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
          'accent-text': 'rgb(var(--theme-accent-text) / <alpha-value>)',
          border: 'rgb(var(--theme-border) / <alpha-value>)',
          cream: 'rgb(var(--theme-cream) / <alpha-value>)',
        },
      },
      fontFamily: {
        serif: ['Georgia', '"Times New Roman"', 'serif'],
        display: ['Georgia', '"Times New Roman"', 'serif'],
        sans: ['Arial', 'Helvetica', 'sans-serif'],
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
        wave: {
          from: { transform: 'scaleY(0.35)' },
          to: { transform: 'scaleY(1.2)' },
        },
        'pulse-ring-accent': {
          '0%': { boxShadow: '0 0 0 0 rgba(245,154,75,0.5)' },
          '70%': { boxShadow: '0 0 0 16px rgba(245,154,75,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(245,154,75,0)' },
        },
        'pulse-ring-danger': {
          '0%': { boxShadow: '0 0 0 0 rgba(224,75,46,0.5)' },
          '70%': { boxShadow: '0 0 0 18px rgba(224,75,46,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(224,75,46,0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in 0.2s ease-out',
        'prism-left': 'prism-left 3.4s ease-in-out infinite',
        'prism-right': 'prism-right 3.4s ease-in-out infinite',
        'prism-left-active': 'prism-left 1.2s ease-in-out infinite',
        'prism-right-active': 'prism-right 1.2s ease-in-out infinite',
        'pulse-ring-accent': 'pulse-ring-accent 1.6s ease-out infinite',
        'pulse-ring-danger': 'pulse-ring-danger 1.1s ease-out infinite',
      },
    },
  },
  plugins: [typography],
} satisfies Config
