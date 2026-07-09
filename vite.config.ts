import fs from 'node:fs'
import type { ClientRequest, IncomingMessage } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Minimal type for Vite's http-proxy instance (no @types/http-proxy required). */
type DevProxyServer = {
  on(
    event: 'proxyReq',
    listener: (proxyReq: ClientRequest, req: IncomingMessage) => void,
  ): void
}

function proxyAuthHeaders(proxy: DevProxyServer, host: string, isDev: boolean) {
  proxy.on('proxyReq', (proxyReq, req) => {
    const auth = req.headers.authorization
    if (typeof auth === 'string') {
      proxyReq.setHeader('X-Serverless-Authorization', auth)
    }
    const iapJwt = req.headers['x-goog-iap-jwt-assertion']
    if (typeof iapJwt === 'string') {
      proxyReq.setHeader('X-Goog-IAP-JWT-Assertion', iapJwt)
    }
    const iapEmail = req.headers['x-goog-authenticated-user-email']
    if (typeof iapEmail === 'string') {
      proxyReq.setHeader('X-Goog-Authenticated-User-Email', iapEmail)
    }
    if (isDev && typeof iapJwt !== 'string') {
      proxyReq.setHeader('X-Dev-IAP-User-Email', 'dev@colt.net')
    }
    proxyReq.setHeader('Host', host)
  })
}

function hostFromOrigin(origin: string): string {
  return new URL(origin).host
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const translationApiOrigin = env.VITE_TRANSLATION_API_ORIGIN
  const salesApiOrigin = env.VITE_SALES_API_ORIGIN
  const tlsCaFile = env.VITE_TLS_CA_FILE || 'certs/colt-internal-ca.pem'
  const coltInternalCa = path.resolve(__dirname, tlsCaFile)
  const tlsCa = fs.existsSync(coltInternalCa)
    ? fs.readFileSync(coltInternalCa, 'utf8')
    : undefined

  const translationProxyTls = tlsCa
    ? { secure: true as const, ca: tlsCa }
    : { secure: false as const }

  if (!translationApiOrigin || !salesApiOrigin) {
    throw new Error(
      'Missing VITE_TRANSLATION_API_ORIGIN or VITE_SALES_API_ORIGIN. ' +
        'Copy .env.example to .env.development or set env vars before build.',
    )
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        // GCE VM / Cloud Run: service account identity token (audience = .run.app URL)
        '/api/metadata/id-token': {
          target: 'http://169.254.169.254',
          changeOrigin: false,
          secure: false,
          rewrite: (path) => {
            const query = path.includes('?') ? path.slice(path.indexOf('?')) : ''
            return `/computeMetadata/v1/instance/service-accounts/default/identity${query}`
          },
          headers: {
            'Metadata-Flavor': 'Google',
          },
        },
        '/api/translation/v1': {
          target: translationApiOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/translation/, '/api'),
          ...translationProxyTls,
          configure: (proxy: DevProxyServer) => {
            proxyAuthHeaders(proxy, hostFromOrigin(translationApiOrigin), mode === 'development')
          },
        },
        '/api/sales/v1': {
          target: salesApiOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/sales/, '/api'),
          ...translationProxyTls,
          configure: (proxy: DevProxyServer) => {
            proxyAuthHeaders(proxy, hostFromOrigin(salesApiOrigin), mode === 'development')
          },
        },
      },
    },
  }
})
