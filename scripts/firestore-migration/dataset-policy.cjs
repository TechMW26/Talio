'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const dotenv = require('dotenv')

function datasetPolicy(dataset, productionCandidate = false) {
  const pattern = productionCandidate ? /^live-[a-z0-9-]{6,70}$/ : /^local-[a-z0-9-]{6,70}$/
  if (!pattern.test(dataset || '')) throw new Error('Explicit isolated dataset required; live datasets require --production-candidate')
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Cloud migration must not inherit emulator settings')
  return { purpose: productionCandidate ? 'production-candidate' : 'local-acceptance-only', verifiedStatus: productionCandidate ? 'verified-production-candidate' : 'verified-local-dataset' }
}

function loadCredentials(root = path.resolve(__dirname, '../..')) {
  const read = name => {
    const file = path.join(root, name)
    return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}
  }
  const local = read('.env.local'), legacy = read('.env')
  const value = local.FIRESTORE_SERVICE_ACCOUNT_JSON || legacy.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!value) throw new Error('Firestore migration service-account credentials missing')
  return JSON.parse(value)
}

function assertIsolated(catalog, policy, verified = false) {
  if (!catalog || catalog.applicationCutover !== false || catalog.purpose !== policy.purpose || (verified && catalog.status !== policy.verifiedStatus)) throw new Error('Dataset must remain isolated with matching purpose and verification')
}

async function invalidateAcceptance(firestore, root, policy) {
  await firestore.runTransaction(async tx => {
    const snapshot = await tx.get(root)
    assertIsolated(snapshot.data(), policy, true)
    tx.update(root, { nativeVerificationRevision: randomUUID(), nativeAcceptance: null, updatedAt: new Date() })
  })
}

module.exports = { datasetPolicy, loadCredentials, assertIsolated, invalidateAcceptance }
