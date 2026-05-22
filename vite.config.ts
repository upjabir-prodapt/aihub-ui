import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Must match src/api/translationConfig.ts and salesConfig.ts */
const TRANSLATION_API_ORIGIN = 'https://translation.aicoesandox-int.colt.net'
const SALES_API_ORIGIN = 'https://salesagent.aicoesandox-int.colt.net'

function proxyAuthHeaders(proxy: import('http-proxy')) {
  proxy.on('proxyReq', (proxyReq, req) => {
    const auth = req.headers.authorization
    if (typeof auth === 'string') {
      proxyReq.setHeader('X-Serverless-Authorization', auth)
    }
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COLT_INTERNAL_CA = path.resolve(__dirname, 'certs/colt-internal-ca.pem')
const tlsCa = fs.existsSync(COLT_INTERNAL_CA)
  ? fs.readFileSync(COLT_INTERNAL_CA, 'utf8')
  : undefined

const translationProxyTls = tlsCa
  ? { secure: true as const, ca: tlsCa }
  : { secure: false as const }

// https://vite.dev/config/
export default defineConfig({
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
      '/api/v1': {
        target: TRANSLATION_API_ORIGIN,
        changeOrigin: true,
        ...translationProxyTls,
        configure: (proxy) => {
          proxyAuthHeaders(proxy)
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Host', 'translation.aicoesandox-int.colt.net')
          })
        },
      },
      '/api/sales/v1': {
        target: SALES_API_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sales/, '/api'),
        ...translationProxyTls,
        configure: (proxy) => {
          proxyAuthHeaders(proxy)
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Host', 'salesagent.aicoesandox-int.colt.net')
          })
        },
      },
    },
  },
})
