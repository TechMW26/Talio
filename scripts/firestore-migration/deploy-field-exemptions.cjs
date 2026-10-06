'use strict'
// Exempt storage-only envelope fields. Never touches data.* business indexes.
const fs = require('node:fs')
const path = require('node:path')
const { PROJECT, IAM_URL, providerFailure } = require('./deploy-indexes.cjs')
const ALLOWED = new Set(['records/overflow', 'records/version', 'parts/bytes'])
function validate(manifest) {
  const fields = manifest.fieldOverrides || []
  if (fields.length !== ALLOWED.size || new Set(fields.map(x => `${x.collectionGroup}/${x.fieldPath}`)).size !== ALLOWED.size) throw new Error('Unexpected exemption manifest')
  for (const field of fields) {
    if (!ALLOWED.has(`${field.collectionGroup}/${field.fieldPath}`) || !Array.isArray(field.indexes) || field.indexes.length) throw new Error('Only approved storage-only exemptions are allowed')
  }
  return fields
}
async function run(client, manifest, apply = false) {
  const fields = validate(manifest)
  const permissions = ['datastore.indexes.get', 'datastore.indexes.update']
  const iam = await client.request({ method: 'POST', url: IAM_URL, data: { permissions }, timeout: 20000 })
  const granted = new Set(iam.data.permissions || [])
  if (!granted.has(permissions[0]) || (apply && !granted.has(permissions[1]))) throw new Error('Missing Firestore index get/update permission; no fields changed')
  const results = []
  for (const field of fields) {
    const name = `projects/${PROJECT}/databases/(default)/collectionGroups/${field.collectionGroup}/fields/${field.fieldPath}`
    const url = `https://firestore.googleapis.com/v1/${name}`
    const current = await client.request({ method: 'GET', url, timeout: 20000 })
    const alreadyExempt = current.data.indexConfig?.usesAncestorConfig === false && !(current.data.indexConfig?.indexes || []).length
    let operation
    if (apply && !alreadyExempt) {
      const result = await client.request({ method: 'PATCH', url, params: { updateMask: 'indexConfig' }, data: { name, indexConfig: { indexes: [] } }, timeout: 20000 })
      operation = result.data.name
    }
    results.push({ field: `${field.collectionGroup}/${field.fieldPath}`, alreadyExempt, ...(operation ? { operation } : {}) })
  }
  return results
}
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: deploy-field-exemptions.cjs [--apply]')
  const root = path.resolve(__dirname, '../..')
  const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')))
  const credentials = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_KEY)
  if (credentials.client_email !== 'firebase-adminsdk-fbsvc@talio-hrms-d6239.iam.gserviceaccount.com') throw new Error('Unexpected service account')
  const { google } = require('googleapis')
  const client = await new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
  console.log(JSON.stringify(await run(client, JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'))), process.argv.includes('--apply'))))
}
module.exports = { validate, run }
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: error.message === 'Missing Firestore index get/update permission; no fields changed' ? error.message : 'Exemption deployment failed', ...providerFailure(error) }))
  process.exitCode = 1
})
