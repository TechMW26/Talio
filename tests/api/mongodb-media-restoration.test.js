const { pack, unpack } = require('../../lib/platform/firestoreCodec.cjs')
const { canonical, sha256 } = require('../../scripts/mongodb-migration/core.cjs')
const { restoreDisposition, CONFIRMATION } = require('../../scripts/mongodb-migration/restore-media-disposition.cjs')
const { memoryMongoDriver } = require('../helpers/mongoDriver')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const dataset = 'restore-test-dataset', run = 'mongo-restore-tests', reportHash = 'a'.repeat(64)
const clone = value => unpack(pack(value))
function fixture() {
  const driver = memoryMongoDriver(), baseCollection = driver.db.collection.bind(driver.db)
  let checkpointFailure = false
  driver.db.collection = name => {
    const base = baseCollection(name)
    return { ...base,
      async updateOne(filter, update) {
        const actual = await base.findOne(filter)
        if (!actual) return { matchedCount: 0 }
        driver.bank(name).set(actual._id, { ...actual, ...clone(update.$set) })
        return { matchedCount: 1 }
      },
      async replaceOne(filter, document) {
        const actual = await base.findOne(filter)
        if (!actual) return { matchedCount: 0 }
        driver.bank(name).set(actual._id, clone(document)); return { matchedCount: 1 }
      },
      async insertOne(document) {
        if (checkpointFailure && name === 'talio_migration_controls' && document._id.startsWith('media-disposition-restore/')) throw new Error('SYNTHETIC_CHECKPOINT_FAILURE')
        if (driver.bank(name).has(document._id)) throw new Error('SYNTHETIC_DUPLICATE')
        driver.bank(name).set(document._id, clone(document)); return { acknowledged: true }
      },
    }
  }
  const before = { _id: '1'.repeat(64), dataset, databaseName: 'talio_company_restore', collectionName: 'employees', recordKey: 'employee-one', envelope: { data: { name: 'Synthetic', profilePicture: 'missing-test.png' } }, parts: [{ id: 'retained', value: { bytes: Buffer.from('original overflow') } }] }
  const after = { ...clone(before), envelope: { data: { name: 'Synthetic' } } }
  const deleted = { ...clone(before), _id: '2'.repeat(64), collectionName: 'screenshots', recordKey: 'screenshot-one' }
  const change = (before, after, reason) => ({ recordKeyHash: sha256(before.recordKey), reason, beforeHash: sha256(canonical(before)), afterHash: after ? sha256(canonical(after)) : null, before: pack(before), after: after ? pack(after) : null })
  const changes = [change(before, after, 'remove-unavailable-media-references'), change(deleted, null, 'remove-unavailable-gallery-record')]
  const report = { command: 'offline-media-disposition', complete: true, userAuthorization: 'remove-unavailable-media-only', sourceArchiveUnmodified: true, run, datasets: [dataset], changedRecords: 2, operationsHash: sha256(changes.map(item => JSON.stringify([item.recordKeyHash, item.reason, item.beforeHash, item.afterHash]) + '\n').join('')) }
  driver.bank('talio_records').set(after._id, clone(after))
  driver.bank('talio_records').set('unrelated', { _id: 'unrelated', dataset, envelope: { retained: true } })
  driver.bank('talio_firestore_archive').set('source-archive', { _id: 'source-archive', original: true })
  driver.bank('talio_catalogs').set(dataset, { _id: dataset, applicationCutover: false, mongoVerified: false })
  driver.bank('talio_migration_controls').set('write-fence', { _id: 'write-fence', active: true, baselineRun: run, candidateRun: run, datasets: [dataset] })
  for (const item of changes) {
    const original = unpack(item.before), id = `media-disposition/${reportHash}/${original._id}`
    driver.bank('talio_migration_controls').set(id, { _id: id, reportHash, recordId: original._id, beforeHash: item.beforeHash, afterHash: item.afterHash })
  }
  return { ...driver, changes, report, reportHash, before, after, deleted, failCheckpoint: () => { checkpointFailure = true } }
}

test('restores exact modified and deleted before-images, preserving source, catalogs, unrelated business data and original checkpoints', async () => {
  const value = fixture(), rawBefore = canonical([...value.bank('talio_firestore_archive').values()])
  const result = await restoreDisposition(value)
  expect(result).toMatchObject({ complete: true, restoredRecords: 2, resumedRecords: 0, beforeImagesVerified: 2, sourceWrites: 0, mediaWrites: 0, catalogsActivated: false, cleanedParityInvalidated: true, finalDeltaRequired: true, freshDispositionAndParityRequired: true, finalCutoverComplete: false })
  expect(canonical(value.bank('talio_records').get(value.before._id))).toBe(canonical(value.before))
  expect(canonical(value.bank('talio_records').get(value.deleted._id))).toBe(canonical(value.deleted))
  expect(value.bank('talio_records').get('unrelated').envelope.retained).toBe(true)
  expect(canonical([...value.bank('talio_firestore_archive').values()])).toBe(rawBefore)
  expect(value.bank('talio_catalogs').get(dataset)).toMatchObject({ applicationCutover: false, mongoVerified: false })
  expect(value.bank('talio_migration_controls').has(`media-disposition/${reportHash}/${value.before._id}`)).toBe(true)
})

test('resume checks exact restored images and refuses rolling back later final delta mutations', async () => {
  const value = fixture(); await restoreDisposition(value)
  expect(await restoreDisposition(value)).toMatchObject({ restoredRecords: 0, resumedRecords: 2 })
  value.bank('talio_records').get(value.before._id).envelope.data.name = 'Later delta'
  await expect(restoreDisposition(value)).rejects.toThrow('RESTORATION_RESUME_STATE_MISMATCH')
  expect(value.bank('talio_records').get(value.before._id).envelope.data.name).toBe('Later delta')
})

test.each(['missing', 'reportHash', 'recordId', 'beforeHash', 'afterHash'])('requires exact original applied checkpoint (%s)', async field => {
  const value = fixture(), id = `media-disposition/${reportHash}/${value.before._id}`
  if (field === 'missing') value.bank('talio_migration_controls').delete(id)
  else value.bank('talio_migration_controls').get(id)[field] = 'incorrect'
  await expect(restoreDisposition(value)).rejects.toThrow('EXACT_APPLIED_DISPOSITION_CHECKPOINT_REQUIRED')
  expect(canonical(value.bank('talio_records').get(value.before._id))).toBe(canonical(value.after))
})

test('rejects changed after-state and foreign scope collisions globally', async () => {
  const modified = fixture(); modified.bank('talio_records').get(modified.before._id).envelope.data.name = 'Changed since cleanup'
  await expect(restoreDisposition(modified)).rejects.toThrow('CURRENT_AFTER_IMAGE_MISMATCH')
  const collision = fixture(); collision.changes = [collision.changes[1]]; collision.report = { ...collision.report, changedRecords: 1, operationsHash: sha256(JSON.stringify([collision.changes[0].recordKeyHash, collision.changes[0].reason, collision.changes[0].beforeHash, null]) + '\n') }
  collision.bank('talio_records').set(collision.deleted._id, { ...collision.deleted, dataset: 'foreign-dataset' })
  await expect(restoreDisposition(collision)).rejects.toThrow('CURRENT_AFTER_IMAGE_MISMATCH')
  expect(collision.bank('talio_records').get(collision.deleted._id).dataset).toBe('foreign-dataset')
})

test.each(['inactive', 'different-run', 'expired', 'activated', 'verified'])('rejects invalid target fence/catalog (%s)', async kind => {
  const value = fixture(), fence = value.bank('talio_migration_controls').get('write-fence'), catalog = value.bank('talio_catalogs').get(dataset)
  if (kind === 'inactive') fence.active = false
  if (kind === 'different-run') fence.candidateRun = 'mongo-final-candidate'
  if (kind === 'expired') fence.expiresAt = new Date(0)
  if (kind === 'activated') catalog.applicationCutover = true
  if (kind === 'verified') catalog.mongoVerified = true
  await expect(restoreDisposition(value)).rejects.toThrow(/WRITE_FENCE_REQUIRED|CATALOG_MUST_REMAIN/)
  expect(canonical(value.bank('talio_records').get(value.before._id))).toBe(canonical(value.after))
})

test('transaction rollback retains after-state when restoration checkpoint commit fails', async () => {
  const value = fixture(); value.failCheckpoint()
  await expect(restoreDisposition(value)).rejects.toThrow('SYNTHETIC_CHECKPOINT_FAILURE')
  expect(canonical(value.bank('talio_records').get(value.before._id))).toBe(canonical(value.after))
  expect(value.bank('talio_migration_controls').has(`media-disposition-restore/${reportHash}/${value.before._id}`)).toBe(false)
})

test('rehashed arbitrary business deletion cannot enter native restore path', async () => {
  const value = fixture(); value.changes[0].after = null; value.changes[0].afterHash = null
  await expect(restoreDisposition(value)).rejects.toThrow('BUSINESS_RECORD_DELETION_FORBIDDEN')
})

test('CLI explicit confirmation and exact target flag parsing fail before reading protected inputs or opening transport', () => {
  const script = path.resolve(__dirname, '../../scripts/mongodb-migration/restore-media-disposition.cjs')
  const env = { ...process.env }; delete env.MONGODB_MEDIA_RESTORATION_CONFIRM
  const refused = spawnSync(process.execPath, [script, 'media-disposition-synthetic-test', '--execute'], { env, encoding: 'utf8' })
  expect(refused.status).toBe(1); expect(refused.stderr).toContain('EXPLICIT_MEDIA_RESTORATION_CONFIRMATION_REQUIRED')
  expect(CONFIRMATION).toBe('restore-exact-media-disposition-before-images-under-maintenance')
  const invalid = spawnSync(process.execPath, [script, 'media-disposition-synthetic-test', '--prepare-fence'], { env, encoding: 'utf8' })
  expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('INVALID_RESTORATION_FLAG')
})
