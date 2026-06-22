import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function hostFromOrigin(origin) {
  return new URL(origin).host
}

const translationOrigin = process.env.VITE_TRANSLATION_API_ORIGIN
const salesOrigin = process.env.VITE_SALES_API_ORIGIN

if (!translationOrigin || !salesOrigin) {
  console.error('VITE_TRANSLATION_API_ORIGIN and VITE_SALES_API_ORIGIN are required')
  process.exit(1)
}

const template = fs.readFileSync(
  path.join(root, 'nginx/default.conf.template'),
  'utf8',
)

const output = template
  .replaceAll('${VITE_TRANSLATION_API_ORIGIN}', translationOrigin)
  .replaceAll('${VITE_SALES_API_ORIGIN}', salesOrigin)
  .replaceAll('${TRANSLATION_API_HOST}', hostFromOrigin(translationOrigin))
  .replaceAll('${SALES_API_HOST}', hostFromOrigin(salesOrigin))

const outPath = path.join(root, 'nginx/default.conf')
fs.writeFileSync(outPath, output)
console.log(`Generated ${outPath}`)
