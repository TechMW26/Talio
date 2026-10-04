'use strict'

const { datasetPolicy, loadCredentials, assertIsolated, invalidateAcceptance } = require('./dataset-policy.cjs')

// Add query projections only to the isolated application copy. Never modifies
// MongoDB, migrationRuns, immutable BSON archives, or production configuration.
const { initializeApp, cert, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { encodeApplicationRecord, decodeApplicationRecord, partIds, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
const { projectNativeRecord } = require('../../lib/platform/searchProjection.cjs')

async function run() {
  const dataset = process.argv.find(arg => arg.startsWith('--dataset='))?.split('=')[1]
  const write = process.argv.includes('--write')
  const policy = datasetPolicy(dataset, process.argv.includes('--production-candidate'))
  const app = initializeApp({ projectId: 'talio-hrms', credential: cert(loadCredentials()) }, `query-projections-${Date.now()}`)
  const firestore = getFirestore(app)
  try {
    const root = firestore.collection('talioDatasets').doc(dataset)
    const catalog = (await root.get()).data()
    assertIsolated(catalog, policy, true)
    if (write) await invalidateAcceptance(firestore, root, policy)
    const report = { dataset, write, collections: {} }
    for (const tenant of catalog.tenants) for (const name of ['employees', 'hrmsworkflows', 'meetings', 'projects', 'tasks', 'policies', 'departments', 'designations', 'onboardingemails', 'projectemailnotificationlogs', 'whiteboards', 'jobpostings', 'candidates', 'performanceappraisals', 'holidays', 'announcements', 'suggestions', 'callalerts', 'assets', 'documents']) {
      const counts = report.collections[name] ||= { scanned: 0, changed: 0, verified: 0 }
      const collection = root.collection('databases').doc(tenant.databaseName).collection('collections').doc(name).collection('records')
      let after
      for (;;) {
        let query = collection.orderBy('__name__').limit(100)
        if (after) query = query.startAfter(after)
        const page = await query.get()
        if (page.empty) break
        const projectSnapshot = async snapshot => {
          counts.scanned++
          const oldEnvelope = snapshot.data(), ids = partIds(oldEnvelope)
          const pieces = ids.length ? await firestore.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
          const original = decodeApplicationRecord(oldEnvelope, new Map(pieces.map(piece => [piece.id, piece.data()])))
          const next = projectNativeRecord(name, original), digest = recordDigest(next)
          if (digest === recordDigest(original)) { counts.verified++; return }
          counts.changed++
          if (!write) return
          const encoded = encodeApplicationRecord(next)
          await firestore.runTransaction(async tx => {
            assertIsolated((await tx.get(root)).data(), policy, true)
            const fresh = await tx.get(snapshot.ref)
            if (!fresh.updateTime.isEqual(snapshot.updateTime)) throw new Error('Record changed while projecting; rerun safely')
            tx.set(snapshot.ref, { ...oldEnvelope, ...encoded.envelope, digest, nativeProjectionVersion: 1 })
            for (const piece of encoded.parts) tx.set(snapshot.ref.collection('parts').doc(piece.id), piece.value)
            for (const id of ids) if (!encoded.parts.some(piece => piece.id === id)) tx.delete(snapshot.ref.collection('parts').doc(id))
          })
          const check = await snapshot.ref.get(), checkIds = partIds(check.data())
          const checkParts = checkIds.length ? await firestore.getAll(...checkIds.map(id => snapshot.ref.collection('parts').doc(id))) : []
          const actual = decodeApplicationRecord(check.data(), new Map(checkParts.map(piece => [piece.id, piece.data()])))
          if (recordDigest(actual) !== digest) throw new Error('Projection read-back verification failed')
          counts.verified++
        }
        // Bound concurrency while retaining one atomic, checked write and an
        // independent readback per record. Restarts safely skip matching data.
        for (let offset = 0; offset < page.docs.length; offset += 8) {
          await Promise.all(page.docs.slice(offset, offset + 8).map(projectSnapshot))
        }
        after = page.docs.at(-1)
      }
      console.log(JSON.stringify({ event: 'projection-collection-complete', collection: name, ...counts }))
    }
    console.log(JSON.stringify(report))
  } finally { await firestore.terminate(); await deleteApp(app) }
}
if (require.main === module) run().catch(error => { console.error(`Native projection failed: ${error.code || error.message}`); process.exitCode = 1 })
module.exports = { run }
