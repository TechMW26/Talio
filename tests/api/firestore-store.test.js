import { createFirestoreDatabase, createTenantFirestoreStore, getFirestoreMembershipBatchSize } from '../../lib/platform/firestoreStore.server'

// Compatibility helpers retain their names so callers do not need a broad
// refactor. Native behavior is covered in mongo-store and acceptance suites.
test('Mongo membership batches keep an explicit bound without legacy disjunction penalties', () => {
  expect(getFirestoreMembershipBatchSize()).toBe(100)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: '==', value: 'active' }])).toBe(100)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: 'in', value: ['pending', 'submitted'] }], [{ field: 'createdAt', direction: 'desc' }])).toBe(100)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: '==' }, { field: 'startDate', operator: '<=' }, { field: 'endDate', operator: '>=' }])).toBe(100)
  expect(getFirestoreMembershipBatchSize([{ field: 'searchGrams', operator: 'array-contains', value: 'abc' }])).toBe(100)
})

describe('Mongo repository compatibility configuration fails closed', () => {
  test('requires an explicit dataset and tenant path', () => {
    expect(() => createFirestoreDatabase({ db: {}, databaseName: 'talio_company_test' })).toThrow('MONGODB_DATASET')
    expect(() => createFirestoreDatabase({ db: {}, dataset: 'local-test-01', databaseName: 'admin' })).toThrow('registered tenant')
  })

  test('rejects source-only handles and unverified tenant authentication', () => {
    expect(() => createFirestoreDatabase({ firestore: {}, dataset: 'local-test-01', databaseName: 'talio_company_test' })).toThrow('MongoDB')
    expect(() => createTenantFirestoreStore({ db: {}, dataset: 'local-test-01', auth: { success: false } })).toThrow('Verified tenant')
  })
})
