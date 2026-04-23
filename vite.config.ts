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
      include: ['src/services/**', 'src/hooks/**', 'src/utils/**'],
      thresholds: { lines: 80 },
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
