'use strict'
// Local configuration cutover only. No hosting API calls or production writes.
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { initializeApp, cert, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
async function main() {
  if (process.env.VERCEL || !process.argv.includes('--write')) throw new Error('Explicit local --write required')
  const dataset = process.argv.find(arg => arg.startsWith('--dataset='))?.slice(10)
  if (!/^local-[a-z0-9-]{6,70}$/.test(dataset || '')) throw new Error('Explicit isolated dataset required')
  const base = dotenv.parse(fs.readFileSync('.env'))
  const service = JSON.parse(base.FIRESTORE_SERVICE_ACCOUNT_JSON || base.FIREBASE_SERVICE_ACCOUNT_KEY)
  const blob = dotenv.parse(fs.readFileSync('.vercel/.env.migration-source.local')).BLOB_READ_WRITE_TOKEN
  if (!blob?.startsWith('vercel_blob_rw_')) throw new Error('Approved private Blob credential is missing')
  const app = initializeApp({ projectId: 'talio-hrms', credential: cert(service) }, `local-config-${Date.now()}`)
  const firestore = getFirestore(app)
  try {
    const catalog = (await firestore.collection('talioDatasets').doc(dataset).get()).data()
    if (catalog?.status !== 'verified-local-dataset' || catalog.purpose !== 'local-acceptance-only' || catalog.applicationCutover !== false) throw new Error('Dataset is not isolated and verified')
    const values = { FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_DATASET: dataset, FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify(service), TALIO_LOCAL_ACCEPTANCE: '1', BLOB_READ_WRITE_TOKEN: blob, BLOB_ACCESS: 'private' }
    const recovery = path.resolve('.migration-data/retired-source/config')
    fs.mkdirSync(recovery, { recursive: true, mode: 0o700 })
    const stamp = Date.now()
    for (const filename of ['.env', '.env.local']) {
      const original = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : ''
      fs.writeFileSync(path.join(recovery, `${filename}-${stamp}`), original, { mode: 0o600, flag: 'wx' })
      const lines = original.split(/\r?\n/).filter(line => {
        const key = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1]
        if (key && /^(?:MONGO|TENANT_DB_|SUPERADMIN_DB_)/.test(key)) return false
        return filename !== '.env.local' || !Object.hasOwn(values, key || '')
      })
      if (filename === '.env.local') lines.push('', '# Isolated Firestore acceptance; external deliveries disabled.', ...Object.entries(values).map(([key, value]) => `${key}=${value}`))
      const temporary = `${filename}.firestore-${stamp}`
      fs.writeFileSync(temporary, lines.join('\n'), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, filename)
    }
    console.log(JSON.stringify({ configured: true, dataset, productionChanged: false, externalDeliveries: false, previousConfigurationBackedUp: true }))
  } finally { await firestore.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(`Local configuration failed: ${error.code || 'VALIDATION_FAILED'}`); process.exitCode = 1 })
