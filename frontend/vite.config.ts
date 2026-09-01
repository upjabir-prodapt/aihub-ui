import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The SPA is now served by the FastAPI BFF from the same origin, and every API
 * call is a relative path. That removes almost everything this file used to do:
 *
 *  - no `VITE_*_API_ORIGIN` / `VITE_*_CLOUD_RUN_URL` — the BFF knows the upstream
 *  - no internal-CA TLS plumbing — the BFF makes the outbound TLS connection
 *  - no `/api/metadata/id-token` proxy — the browser no longer mints ID tokens
 *  - no `viteMockApiPlugin` — mocks moved into the BFF behind `UPSTREAM_MODE=mock`,
 *    so dev traffic goes through the same session, CSRF and proxy code as prod
 *
 * In development, Vite serves the bundle on :5173 and forwards `/auth` and
 * `/api` to uvicorn on :8080.
 */

const BFF_TARGET = process.env.BFF_ORIGIN ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': { target: BFF_TARGET, changeOrigin: false },
      '/api': { target: BFF_TARGET, changeOrigin: false },
      '/healthz': { target: BFF_TARGET, changeOrigin: false },
      '/readyz': { target: BFF_TARGET, changeOrigin: false },
      '/docs': { target: BFF_TARGET, changeOrigin: false },
      '/openapi.json': { target: BFF_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
