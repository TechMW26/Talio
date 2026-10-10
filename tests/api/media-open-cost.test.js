import { getImage } from '@/lib/mediaStorage'
import { getFirestoreApplicationContext, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { createMongoMediaRepository as createFirestoreMediaRepository } from '@/lib/platform/mongoMedia.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({
  getFirestoreApplicationContext: jest.fn(), getFirestoreTenantDatabase: jest.fn(),
}))
jest.mock('@/lib/platform/mongoMedia.server', () => ({
  createMongoMediaRepository: jest.fn(), getMongoMediaRepository: jest.fn(), getMongoMediaStats: jest.fn(),
}))

test('opening a tenant image resolves its descriptor once without a second metadata query', async () => {
  const id = '111111111111111111111111'
  const open = jest.fn(async () => ({ stream: new Blob(['image bytes']).stream() }))
  const repository = { resolve: jest.fn(async () => ({ file: { _id: id }, open })), info: jest.fn() }
  getFirestoreApplicationContext.mockResolvedValue({ databaseName: 'talio_company_a' })
  createFirestoreMediaRepository.mockReturnValue(repository)
  expect(await getImage(id, { databaseName: 'talio_company_a' })).toEqual(Buffer.from('image bytes'))
  expect(repository.resolve).toHaveBeenCalledTimes(1)
  expect(repository.resolve).toHaveBeenCalledWith('images', id)
  expect(repository.info).not.toHaveBeenCalled()
  expect(getFirestoreTenantDatabase).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)
})
