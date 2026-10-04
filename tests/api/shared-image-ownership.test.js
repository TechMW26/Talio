import { getImageInfo } from '@/lib/mediaStorage'
import { getFirestoreApplicationContext, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { createFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreApplicationContext: jest.fn(), getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreMedia.server', () => ({ createFirestoreMediaRepository: jest.fn(), getFirestoreMediaRepository: jest.fn() }))
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa'
let tenant, sharedFile, localFile
beforeEach(() => {
  jest.clearAllMocks()
  sharedFile = { _id: id, metadata: { userId: 'owner-a', employeeId: 'employee-a' } }
  localFile = null
  tenant = { get: jest.fn(async () => null) }
  getFirestoreApplicationContext.mockImplementation(async databaseName => ({ databaseName, dataset: 'isolated-dataset' }))
  getFirestoreTenantDatabase.mockResolvedValue(tenant)
  createFirestoreMediaRepository.mockImplementation(context => ({
    info: jest.fn(async () => context.sourceDatabase === 'test'
      ? await context.authorizeLegacyImage(sharedFile) ? { file: sharedFile } : null
      : localFile ? { file: localFile } : null),
  }))
})
test('shared-source image metadata cannot leak through a foreign tenant', async () => {
  expect(await getImageInfo(id, { databaseName: 'talio_company_other' })).toBeNull()
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('talio_company_other')
  expect(tenant.get).toHaveBeenCalledWith('users', 'owner-a')
  expect(tenant.get).toHaveBeenCalledWith('employees', 'employee-a')
})
test.each(['users', 'employees'])('shared-source image requires an actual %s owner in the authenticated tenant', async collection => {
  tenant.get.mockImplementation(async (name, ownerId) => name === collection ? { _id: ownerId } : null)
  expect(await getImageInfo(id, { databaseName: 'talio_company_owner' })).toEqual(sharedFile)
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('talio_company_owner')
})
test('shared uploads with no owner fail closed even in an otherwise valid tenant', async () => {
  sharedFile.metadata = {}
  expect(await getImageInfo(id, { databaseName: 'talio_company_owner' })).toBeNull()
  expect(tenant.get).not.toHaveBeenCalled()
})
test('tenant-local image IDs are resolved before shared-source lookup', async () => {
  localFile = { _id: id, metadata: { userId: 'local-owner' } }
  expect(await getImageInfo(id, { databaseName: 'talio_company_owner' })).toEqual(localFile)
  expect(getFirestoreTenantDatabase).not.toHaveBeenCalled()
  expect(createFirestoreMediaRepository).toHaveBeenCalledTimes(1)
  expect(createFirestoreMediaRepository.mock.results[0].value.info).toHaveBeenCalledTimes(1)
})
