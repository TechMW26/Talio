jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(), clearCachePattern: jest.fn().mockResolvedValue() }))
jest.mock('@/lib/platform/firestoreEmployeeAccount.server', () => ({ mutateFirestoreEmployee: jest.fn().mockResolvedValue({}) }))
jest.mock('@/lib/employeeDetails.server', () => ({ readEmployeeDetails: jest.fn().mockResolvedValue({}) }))
jest.mock('@/lib/kriGenerator', () => ({ generateAndStoreKRIsKPIs: jest.fn().mockResolvedValue() }))
jest.mock('@/lib/mediaStorage', () => ({ uploadImage: jest.fn().mockResolvedValue({ _id: 'photo', url: '/api/images/photo' }), deleteImage: jest.fn().mockResolvedValue() }))
const sharp = require('sharp')
const { uploadImage } = require('@/lib/mediaStorage')
const { getAuthAndDatabase } = require('@/lib/auth')
const { mutateFirestoreEmployee } = require('@/lib/platform/firestoreEmployeeAccount.server')
const { PUT } = require('@/app/api/employees/[id]/route')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')
const employeeId = '6957b35cbf0b9ea49ca507a1', managerId = '111111111111111111111111'
let database
beforeEach(() => {
  jest.clearAllMocks()
  database = workflowStore({ employees: [{ _id: employeeId, employeeCode: 'EMP-001', email: 'employee@example.test', designationLevel: 9 }, { _id: managerId, designationLevel: 6 }] })
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'admin', role: 'admin' }, tenant: { databaseName: 'talio_company_test' }, database })
})
const update = input => PUT(new Request(`https://talio.test/api/employees/${employeeId}`, { method: 'PUT', body: JSON.stringify(input) }), { params: Promise.resolve({ id: employeeId }) })
test('empty optional relationships persist as null through the atomic employee/account writer', async () => {
  const input = { reportsTo: '', reportingManager: '', assignedManager: '', assignedTeamLead: '', designation: '', department: '', company: '', departments: [] }
  expect((await update(input)).status).toBe(200)
  expect(mutateFirestoreEmployee).toHaveBeenCalledWith(expect.objectContaining({ employeeId, databaseName: 'talio_company_test', expectedDigest: expect.any(String), patch: expect.objectContaining(Object.fromEntries(Object.keys(input).map(key => [key, key === 'departments' ? [] : null]))) }))
})
test('clearing the team lead reroutes approvals to the retained manager', async () => {
  await database.mutate('employees', employeeId, e => ({ ...e, designationLevel: 2, assignedManager: managerId, assignedTeamLead: '222222222222222222222222', reportingManager: '222222222222222222222222' }))
  expect((await update({ assignedTeamLead: '' })).status).toBe(200)
  expect(mutateFirestoreEmployee).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ assignedTeamLead: null, reportingManager: managerId }) }))
})
test('malformed relationships are rejected before any write', async () => {
  const response = await update({ assignedManager: 'not-an-id' })
  expect(response.status).toBe(400)
  expect((await response.json()).message).toMatch(/assigned\s?manager/i)
  expect(mutateFirestoreEmployee).not.toHaveBeenCalled()
})
test('photo uploads store untouched full-resolution bytes with separate validated framing', async () => {
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#ccddee' } }).png().toBuffer()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'self', role: 'employee', employeeId }, tenant: { databaseName: 'talio_company_test' }, database })
  const response = await update({ profilePicture: `data:image/png;base64,${bytes.toString('base64')}`, profilePictureViewport: { scale: 2, x: 15 } })
  expect(response.status).toBe(200)
  expect(uploadImage).toHaveBeenCalledWith(bytes, expect.objectContaining({ contentType: 'image/png', employeeId }))
  const stored = uploadImage.mock.calls[0][0]
  expect(await sharp(stored).metadata()).toMatchObject({ width: 1200, height: 800 })
  expect(mutateFirestoreEmployee).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ profilePicture: '/api/images/photo', profilePictureViewport: expect.objectContaining({ scale: 2, x: 15 }) }) }))
})
test('invalid framing is rejected before storage work', async () => {
  expect((await update({ profilePictureViewport: { scale: 50 } })).status).toBe(400)
  expect(uploadImage).not.toHaveBeenCalled()
  expect(mutateFirestoreEmployee).not.toHaveBeenCalled()
})
