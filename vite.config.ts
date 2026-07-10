import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  // Inject JS bundle version + build timestamp so we can verify from the
  // Settings modal that the APK contains a fresh bundle (and not an old
  // cached one, as happened during the 1.0.30→1.0.32 debugging).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // Mode démo preview (revue design sans login Google) — BARRIÈRE
    // BUILD-TIME : vrai UNIQUEMENT sur les déploiements de PREVIEW Cloudflare
    // (CF_PAGES=1 et branche ≠ prod). Sur le build de prod (branche main),
    // c'est `false` figé → le tree-shaking de Vite élimine entièrement le code
    // démo du bundle : le bypass de login n'EXISTE PAS en prod (audit sécu
    // red-team Opus). Le runtime ajoute une 2e barrière (hostname + natif).
    __DEMO_ALLOWED__: JSON.stringify(
      process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH !== 'main'
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/services/**',
        'src/hooks/**',
        'src/utils/**',
        'src/components/shared/MarkdownRenderer.tsx',
        'functions/api/**',
      ],
      // Baseline mesurée en CI, à relever progressivement. Le précédent 80 %
      // n'avait jamais été atteint et empêchait toute exécution de `verify`.
      thresholds: { statements: 27, branches: 24, functions: 31, lines: 28 },
    },
  },
  server: {
    port: 5173,
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          markdown: ['react-markdown', 'rehype-raw', 'rehype-highlight', 'rehype-sanitize', 'remark-gfm'],
        },
      },
    },
  },
})
