import fs from 'node:fs'
import path from 'node:path'
import { MongoFieldPath } from '../../lib/platform/mongoFieldPath.server'
import { createFirestoreDatabase, createTenantFirestoreStore } from '../../lib/platform/firestoreStore.server'
import { memoryMongoDriver } from '../helpers/mongoDriver'

test('application runtime modules import no Firestore SDK or source data client', () => {
  for (const file of ['firestoreApplication.server.js', 'firestoreStore.server.js', 'firestoreEmployeeAccount.server.js', 'firestoreProvisioning.server.js', 'firestoreSuperadmin.server.js', 'firestore.server.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/platform', file), 'utf8')
    expect(source).not.toMatch(/from ['"]firebase-admin\/firestore['"]|import .*getTalioFirestore/)
  }
})

test('runtime audit rejects retired Firestore imports and configuration reads', () => {
  const { audit } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  const report = audit()
  expect(report.counts.firestoreImport).toBe(0)
  expect(report.counts.firestoreNamespace).toBe(0)
  expect(report.counts.firestoreConfiguration).toBe(0)
  expect(report.counts.firestoreRest).toBe(0)
  expect(report.counts.firestoreForeignSdk).toBe(0)
  expect(report.counts.offlineToolImport).toBe(0)
  expect(report.counts.offlineToolStartup).toBe(0)
  expect(report.runtimeDirectories).toEqual(expect.arrayContaining(['src', 'public', 'desktop-app', 'mobile', 'socket-server', 'scripts']))
  expect(report.offlineTools).toContain('scripts/mongodb-migration/migrate.cjs')
  expect(report.packageFilesScanned).toBeGreaterThanOrEqual(2)
  expect(report.complete).toBe(true)
})

test.each(['instrumentation.js', 'desktop-app/src/main.js', 'socket-server/server.js', 'mobile/lib/database.dart', 'scripts/daily-maintenance.cjs', 'scripts/firestore-migration/new-runtime.cjs'])('source SDKs are forbidden in operational entrypoint %s', file => {
  const { inspectSource } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  expect(inspectSource(file, "const { getFirestore } = require('firebase-admin/firestore')")).toMatchObject({ kinds: { firestoreImport: [1] } })
})

test('native/mobile, service-worker and REST data-plane paths are rejected while FCM remains permitted', () => {
  const { inspectSource } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  for (const source of [
    'from google.cloud import firestore',
    'from firebase_admin import credentials, firestore',
    'let db = Firestore.firestore()',
    'FirebaseFirestore.instance.collection("records")',
    'importScripts("https://www.gstatic.com/firebasejs/11/firebase-firestore-compat.js")',
  ]) expect(inspectSource('desktop-app/runtime.py', source)?.kinds.firestoreForeignSdk).toEqual([1])
  expect(inspectSource('lib/remote-data.js', 'fetch("https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents")')?.kinds.firestoreRest).toEqual([1])
  expect(inspectSource('public/firebase-messaging-sw.js', 'firebase.messaging();')).toBeNull()
})

test('offline tools cannot be imported into runtime or activated through package lifecycle commands', () => {
  const { inspectSource, inspectPackageScripts } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  expect(inspectSource('lib/unsafe.js', "require('../scripts/mongodb-migration/migrate.cjs')")?.kinds.offlineToolImport).toEqual([1])
  expect(inspectSource('scripts/mongodb-migration/migrate.cjs', "require('firebase-admin/firestore')")).toBeNull()
  expect(inspectPackageScripts({ start: 'node scripts/firestore-migration/configure-local.cjs', 'migration:export': 'node scripts/mongodb-migration/migrate.cjs' })).toEqual([{ file: 'package.json', kinds: { offlineToolStartup: ['start'] } }])
  expect(inspectPackageScripts({ prebuild: 'npm run migration:export', 'migration:export': 'node scripts/mongodb-migration/migrate.cjs' })).toEqual([{ file: 'package.json', kinds: { offlineToolStartup: ['prebuild'] } }])
  expect(inspectPackageScripts({ start: 'npm run start', prebuild: 'npm run map', map: 'node scripts/generate-mira-app-map.cjs' })).toEqual([])
  expect(inspectPackageScripts({ start: 'node ../scripts/mongodb-migration/migrate.cjs' }, 'desktop-app/package.json')).toEqual([{ file: 'desktop-app/package.json', kinds: { offlineToolStartup: ['start'] } }])
})

test('native Mongo exemptions are adapter-specific and never permit Mongoose', () => {
  const { inspectSource } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  expect(inspectSource('lib/platform/mongoStore.server.js', "import { ObjectId } from 'mongodb'")).toBeNull()
  expect(inspectSource('app/api/unsafe/route.js', "import { MongoClient } from 'mongodb'")?.kinds.driverImport).toEqual([1])
  expect(inspectSource('lib/platform/mongoStore.server.js', "import mongoose from 'mongoose'")?.kinds.driverImport).toEqual([1])
})

test('workflow field paths preserve the segments contract without SDK initialization', () => {
  const field = new MongoFieldPath('data', 'setupCode', 'code')
  expect(field.segments).toEqual(['data', 'setupCode', 'code'])
  expect(field.toString()).toBe('data.setupCode.code')
  expect(Object.isFrozen(field.segments)).toBe(true)
  expect(() => new MongoFieldPath('data', '__proto__')).toThrow('Invalid')
})

test('legacy repository helper names use native Mongo and preserve verified tenant guards', async () => {
  const native = memoryMongoDriver(), dataset = 'mongo-compat-test', databaseName = 'talio_company_compat'
  const store = createFirestoreDatabase({ ...native, dataset, databaseName })
  await store.create('records', { _id: 'record', data: 'native' })
  const tenant = createTenantFirestoreStore({ ...native, dataset, auth: { success: true, user: { _id: 'actor' }, tenant: { databaseName } } })
  expect(await tenant.get('records', 'record')).toEqual({ _id: 'record', data: 'native' })
  expect(() => createTenantFirestoreStore({ ...native, dataset, auth: { success: false } })).toThrow('Verified tenant authentication')
})
