'use strict'

const { datasetPolicy, loadCredentials, assertIsolated, invalidateAcceptance } = require('./dataset-policy.cjs')

// Copy only histories whose immutable user ID resolves to exactly one registered
// tenant. Shared originals and source archives are never modified or deleted.
const { initializeApp, cert, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { applicationRecordKey, encodeApplicationRecord, decodeApplicationRecord, partIds, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')

async function run() {
  const dataset = process.argv.find(arg => arg.startsWith('--dataset='))?.split('=')[1]
  const write = process.argv.includes('--write')
  const policy = datasetPolicy(dataset, process.argv.includes('--production-candidate'))
  const app = initializeApp({ projectId: 'talio-hrms', credential: cert(loadCredentials()) }, `history-routing-${Date.now()}`)
  const firestore = getFirestore(app)
  try {
    const root = firestore.collection('talioDatasets').doc(dataset)
    const catalog = (await root.get()).data()
    assertIsolated(catalog, policy, true)
    if (write) await invalidateAcceptance(firestore, root, policy)
    const collection = (database, name) => root.collection('databases').doc(database).collection('collections').doc(name).collection('records')
    async function decode(snapshot) {
      const ids = partIds(snapshot.data())
      const pieces = ids.length ? await firestore.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
      return decodeApplicationRecord(snapshot.data(), new Map(pieces.map(piece => [piece.id, piece.data()])))
    }
    const report = { dataset, write, source: 0, resolved: 0, unresolved: 0, copied: 0, verified: 0 }
    let cursor
    for (;;) {
      let query = collection('test', 'aicontexts').orderBy('__name__').limit(100)
      if (cursor) query = query.startAfter(cursor)
      const page = await query.get()
      if (page.empty) break
      for (const snapshot of page.docs) {
        report.source++
        const record = await decode(snapshot)
        if (!record.userId) { report.unresolved++; continue }
        const candidates = await firestore.getAll(...catalog.tenants.map(tenant => collection(tenant.databaseName, 'users').doc(applicationRecordKey(String(record.userId)))))
        const owners = candidates.flatMap((owner, index) => owner.exists ? [catalog.tenants[index]] : [])
        if (owners.length !== 1) { report.unresolved++; continue }
        report.resolved++
        const target = collection(owners[0].databaseName, 'aicontexts').doc(applicationRecordKey(String(record._id)))
        const current = await target.get()
        if (current.exists) {
          if (recordDigest(await decode(current)) !== recordDigest(record)) throw new Error('Tenant history conflicts with source; preserving both for review')
          report.verified++; continue
        }
        if (!write) continue
        const encoded = encodeApplicationRecord(record)
        await firestore.runTransaction(async tx => {
          assertIsolated((await tx.get(root)).data(), policy, true)
          const [freshSource, freshTarget] = await Promise.all([tx.get(snapshot.ref), tx.get(target)])
          if (!freshSource.updateTime.isEqual(snapshot.updateTime)) throw new Error('Source changed while copying')
          if (freshTarget.exists) throw new Error('Target created concurrently; rerun to verify')
          tx.create(target, { ...encoded.envelope, digest: recordDigest(record), legacySourceDatabase: 'test' })
          for (const part of encoded.parts) tx.create(target.collection('parts').doc(part.id), part.value)
        })
        if (recordDigest(await decode(await target.get())) !== recordDigest(record)) throw new Error('Copied history verification failed')
        report.copied++; report.verified++
      }
      cursor = page.docs.at(-1)
    }
    console.log(JSON.stringify(report))
    if (report.unresolved) throw new Error('Unresolved histories remain preserved in shared archive')
  } finally { await firestore.terminate(); await deleteApp(app) }
}
if (require.main === module) run().catch(error => { console.error(`History routing failed: ${error.code || error.message}`); process.exitCode = 1 })
module.exports = { run }
