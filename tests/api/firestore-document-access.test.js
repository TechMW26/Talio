import { canReadDocumentUpload } from '@/lib/documentAccess.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
const owner = { _id: '111111111111111111111111', role: 'hr' }
const employee = { _id: '222222222222222222222222', role: 'employee', employeeId: '333333333333333333333333' }
let auth, store
beforeEach(() => {
  jest.clearAllMocks()
  auth = { success: true, user: employee, tenant: { databaseName: 'talio_company_first' } }
  store = workflowStore({ users: [owner, employee], documents: [{ _id: '444444444444444444444444', employee: employee.employeeId, fileId: 'private-file', status: 'issued', isActive: true }] })
  getFirestoreTenantDatabase.mockResolvedValue(store)
})
test('rejects unverified, missing-tenant and other-tenant owner references', async () => {
  expect(await canReadDocumentUpload({ success: false }, { fileId: 'private-file', ownerId: owner._id })).toBe(false)
  expect(await canReadDocumentUpload({ ...auth, tenant: null }, { fileId: 'private-file', ownerId: owner._id })).toBe(false)
  expect(await canReadDocumentUpload(auth, { fileId: 'private-file', ownerId: '999999999999999999999999' })).toBe(false)
})
test('uses indexed exact file lookup and allows issued employee evidence', async () => {
  expect(await canReadDocumentUpload(auth, { fileId: 'private-file', ownerId: owner._id })).toBe(true)
  expect(store.list).toHaveBeenCalledWith('documents', expect.objectContaining({ filters: [{ field: 'fileId', operator: '==', value: 'private-file' }] }))
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('talio_company_first', expect.anything())
})
test('preserves HR-issued legacy status but denies pending, deleted and unrelated evidence', async () => {
  const set = changes => store.mutate('documents', '444444444444444444444444', current => ({ ...current, ...changes }))
  for (const changes of [{ status: 'pending' }, { status: 'issued', isActive: false }, { isActive: true, employee: 'other' }]) {
    await set(changes)
    expect(await canReadDocumentUpload(auth, { fileId: 'private-file', ownerId: owner._id })).toBe(false)
  }
  await set({ employee: employee.employeeId, status: undefined })
  expect(await canReadDocumentUpload(auth, { fileId: 'private-file', ownerId: owner._id })).toBe(true)
})
