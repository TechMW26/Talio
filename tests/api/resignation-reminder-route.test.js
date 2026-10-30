jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/hrms/resignationStore.server', () => ({ getResignationStore: jest.fn() }))
jest.mock('@/lib/actionableNotificationStore.server', () => ({ ...jest.requireActual('@/lib/actionableNotificationStore.server'), getActionableDatabase: jest.fn() }))
import { GET } from '@/app/api/actionable-notifications/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getResignationStore } from '@/lib/hrms/resignationStore.server'
import { getActionableDatabase } from '@/lib/actionableNotificationStore.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'

test('route awaits the async resignation store and creates the HR card', async () => {
  const database = workflowStore()
  const store = workflowStore({ resignationrequests: [{ _id: 'r', employee: 'e', status: 'hr_review', active: true }], employees: [{ _id: 'e', firstName: 'A', lastName: 'B' }] })
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'hr', role: 'hr' }, companyFeatures: { exitManagement: true }, tenant: { databaseName: 'x' } })
  getActionableDatabase.mockResolvedValue(database)
  getResignationStore.mockResolvedValue(store)
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  await GET(new Request('https://t.test/api/actionable-notifications'))
  expect(errors.mock.calls.filter(call => String(call[0]).includes('Resignation reminder'))).toEqual([])
  expect((await database.list('actionablenotifications')).records.some(card => card.title.startsWith('Pending resignations'))).toBe(true)
})