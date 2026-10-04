'use strict'

const { datasetPolicy, loadCredentials, assertIsolated, invalidateAcceptance } = require('./dataset-policy.cjs')

// Operates only on the verified isolated Firestore application copy. Source
// database and immutable migration archives are never modified or deleted.
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const dotenv = require('dotenv')
const { initializeApp, cert, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { get, put } = require('@vercel/blob')
const { encodeApplicationRecord, decodeApplicationRecord, partIds } = require('../../lib/platform/firestoreCodec.cjs')
const hash = value => createHash('sha256').update(value).digest('hex')

async function run() {
  const dataset = process.argv.find(arg => arg.startsWith('--dataset='))?.split('=')[1]
  const write = process.argv.includes('--write')
  const policy = datasetPolicy(dataset, process.argv.includes('--production-candidate'))
  const token = dotenv.parse(fs.readFileSync('.vercel/.env.migration-source.local')).BLOB_READ_WRITE_TOKEN
  const app = initializeApp({ projectId: 'talio-hrms', credential: cert(loadCredentials()) }, `embedded-media-${Date.now()}`)
  const firestore = getFirestore(app)
  try {
    const root = firestore.collection('talioDatasets').doc(dataset)
    const catalog = (await root.get()).data()
    assertIsolated(catalog, policy, true)
    if (write) await invalidateAcceptance(firestore, root, policy)
    const report = { dataset, write, found: 0, migrated: 0, bytes: 0 }
    for (const tenant of catalog.tenants) {
      const collection = root.collection('databases').doc(tenant.databaseName).collection('collections').doc('mirageneratedimages').collection('records')
      let after
      for (;;) {
        let query = collection.orderBy('__name__').limit(100)
        if (after) query = query.startAfter(after)
        const page = await query.get()
        if (!page.size) break
        for (const snapshot of page.docs) {
          const ids = partIds(snapshot.data())
          const parts = ids.length ? await firestore.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
          const record = decodeApplicationRecord(snapshot.data(), new Map(parts.map(part => [part.id, part.data()])))
          if (!Buffer.isBuffer(record.imageBuffer) || !record.imageBuffer.length) continue
          const bytes = record.imageBuffer, sha256 = hash(bytes)
          report.found++; report.bytes += bytes.length
          if (!write) continue
          if (!/^[a-f0-9]{24}$/.test(String(record.user)) || !/^[a-f0-9]{24}$/.test(String(record._id))) throw new Error('Embedded image ownership must be valid')
          const pathname = `tenants/${tenant.databaseName}/mira-images/${record.user}/migrated-${record._id}-${sha256}.png`
          let blob = await get(pathname, { access: 'private', useCache: false, token, abortSignal: AbortSignal.timeout(30000) })
          if (!blob) {
            await put(pathname, bytes, { access: 'private', token, addRandomSuffix: false, allowOverwrite: false, contentType: record.contentType || 'image/png', abortSignal: AbortSignal.timeout(30000) })
            blob = await get(pathname, { access: 'private', useCache: false, token, abortSignal: AbortSignal.timeout(30000) })
          }
          if (!blob?.stream || blob.statusCode !== 200) throw new Error('Private copied image unavailable')
          const verified = Buffer.from(await new Response(blob.stream).arrayBuffer())
          if (verified.length !== bytes.length || hash(verified) !== sha256) throw new Error('Copied image checksum mismatch')
          const { imageBuffer, ...fields } = record
          const next = { ...fields, pathname, sha256, byteLength: bytes.length, contentType: record.contentType || 'image/png', embeddedMediaMigratedAt: new Date() }
          const encoded = encodeApplicationRecord(next)
          if (encoded.parts.length) throw new Error('Unexpected image metadata overflow')
          await firestore.runTransaction(async tx => {
            assertIsolated((await tx.get(root)).data(), policy, true)
            const current = await tx.get(snapshot.ref)
            if (current.updateTime.toMillis() !== snapshot.updateTime.toMillis()) throw new Error('Image changed during media migration')
            tx.set(snapshot.ref, encoded.envelope)
            for (const id of ids) tx.delete(snapshot.ref.collection('parts').doc(id))
          })
          const reread = decodeApplicationRecord((await snapshot.ref.get()).data())
          if (reread.imageBuffer || reread.sha256 !== sha256 || reread.byteLength !== bytes.length) throw new Error('Media reference verification failed')
          report.migrated++
        }
        after = page.docs.at(-1)
      }
    }
    console.log(JSON.stringify(report))
  } finally { await firestore.terminate(); await deleteApp(app) }
}
if (require.main === module) run().catch(error => { console.error(`Embedded media migration failed: ${error.code || error.message}`); process.exitCode = 1 })
module.exports = { run }
