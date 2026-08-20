import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function hostFromOrigin(origin) {
  return new URL(origin).host
}

// Architecture B: nginx proxies /api/translation/* and /api/sales/* directly to
// the Translation/Sales-Agent Cloud Run *.run.app URLs (not their dedicated
// internal-DNS/ILB origins) — see nginx/default.conf.template for why. These are
// the same URLs already used as the Cloud Run IAM identity-token audience.
const translationCloudRunUrl = process.env.VITE_TRANSLATION_CLOUD_RUN_URL
const salesCloudRunUrl = process.env.VITE_SALES_CLOUD_RUN_URL

if (!translationCloudRunUrl || !salesCloudRunUrl) {
  console.error('VITE_TRANSLATION_CLOUD_RUN_URL and VITE_SALES_CLOUD_RUN_URL are required')
  process.exit(1)
}

const template = fs.readFileSync(
  path.join(root, 'nginx/default.conf.template'),
  'utf8',
)

const output = template
  .replaceAll('${VITE_TRANSLATION_CLOUD_RUN_URL}', translationCloudRunUrl)
  .replaceAll('${VITE_SALES_CLOUD_RUN_URL}', salesCloudRunUrl)
  .replaceAll('${TRANSLATION_CLOUD_RUN_HOST}', hostFromOrigin(translationCloudRunUrl))
  .replaceAll('${SALES_CLOUD_RUN_HOST}', hostFromOrigin(salesCloudRunUrl))

const outPath = path.join(root, 'nginx/default.conf')
fs.writeFileSync(outPath, output)
console.log(`Generated ${outPath}`)
