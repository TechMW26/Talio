jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/leaveApi.server', () => ({ afterChange: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { APPLICATION_SEARCH_OPTIONS, searchApplicationRecords } from '@/lib/applicationSearch.server'
const { substringGrams, projectNativeRecord, MAX_SEARCH_GRAMS, SEARCH_GRAM_OVERFLOW_SENTINEL } = require('../../lib/platform/searchProjection.cjs')
const { encodeApplicationRecord, decodeApplicationRecord } = require('../../lib/platform/firestoreCodec.cjs')

const longText = Array.from({ length: 1500 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('')
test('normal projections remain exact up to the limit and never retain a truncated gram list', () => {
  expect(substringGrams(['Anna'])).toEqual(['a', 'an', 'ann', 'n', 'na', 'nn', 'nna'])
  const values = Array.from({ length: MAX_SEARCH_GRAMS }, (_, index) => String.fromCodePoint(0x4e00 + index))
  expect(substringGrams(values)).toHaveLength(MAX_SEARCH_GRAMS)
  expect(substringGrams([...values, 'z'])).toEqual([SEARCH_GRAM_OVERFLOW_SENTINEL])
})
test('large searchable text keeps its candidate index inline without altering source fields', () => {
  const source = { _id: 'document', title: 'Original title', description: `${longText} unique-find-tail` }
  const projected = projectNativeRecord('documents', source)
  const encoded = encodeApplicationRecord(projected)
  expect(encoded.envelope.data.searchGrams).toEqual([SEARCH_GRAM_OVERFLOW_SENTINEL])
  expect(encoded.envelope.overflow.some(part => part.field === 'searchGrams')).toBe(false)
  const decoded = decodeApplicationRecord(encoded.envelope, new Map(encoded.parts.map(part => [part.id, part.value])))
  expect(decoded).toEqual({ ...source, searchGrams: [SEARCH_GRAM_OVERFLOW_SENTINEL] })
  expect(source.searchGrams).toBeUndefined()
})

const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('indexed long-text candidates retain exact matches and tenant boundaries', () => {
  let firestore
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => { await firestore?.terminate() })
  test('search finds a suffix after overflow and filters unrelated, hidden and other-tenant candidates', async () => {
    const dataset = `test-search-overflow-${Date.now()}`
    const database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_overflow', ...APPLICATION_SEARCH_OPTIONS })
    const other = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_other', ...APPLICATION_SEARCH_OPTIONS })
    const rows = [
      { _id: 'match', employee: 'employee', description: `${longText} unique-find-tail` },
      { _id: 'not-match', employee: 'employee', description: `${longText} unrelated suffix` },
      { _id: 'other-owner', employee: 'other', description: `${longText} unique-find-tail` },
      { _id: 'deleted', employee: 'employee', description: `${longText} unique-find-tail`, deletedAt: new Date() },
    ]
    for (const row of rows) await database.create('documents', row)
    await other.create('documents', { ...rows[0], _id: 'other-tenant' })
    const candidatePage = await database.list('documents', { filters: [{ field: 'searchGrams', operator: 'array-contains', value: 'uni' }, { field: 'employee', operator: '==', value: 'employee' }], limit: 100 })
    expect(candidatePage.records.map(row => row._id).sort()).toEqual(['deleted', 'match', 'not-match'])
    const results = await searchApplicationRecords(database, { _id: 'user', role: 'employee', employeeId: 'employee' }, { _id: 'employee' }, 'unique-find-tail', path => path === '/dashboard/documents')
    expect(results.documents.map(row => row._id)).toEqual(['match'])
  }, 30000)
})
