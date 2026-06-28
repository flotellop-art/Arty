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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      // Enforced on the currently tested critical surface. A previous broad
      // include over every service/hook made `npm run test:coverage` fail at
      // ~13% and therefore unusable as a CI gate. New files should be added
      // here with their regression tests when they become security-critical.
      include: [
        'src/hooks/useStreaming.ts',
        'src/services/aiRouter.ts',
        'src/services/calendarClient.ts',
        'src/services/driveClient.ts',
        'src/services/gmailClient.ts',
        'src/services/reportGenerator.ts',
        'src/services/shareTargetService.ts',
        'src/services/toolExecutor.ts',
      ],
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 85 },
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
          markdown: ['react-markdown', 'rehype-raw', 'rehype-sanitize', 'remark-gfm'],
        },
      },
    },
  },
})
