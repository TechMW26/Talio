jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/hrms/lifecycleStore.server', () => ({ getLifecycleDatabase: jest.fn() }))
jest.mock('@/lib/performanceStore.server', () => ({ performanceDatabase: jest.fn() }))
jest.mock('@/lib/hrms/performanceAppraisalStore.server', () => ({ listAppraisals: jest.fn() }))
import { GET } from '@/app/api/employees/[id]/history/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getLifecycleDatabase } from '@/lib/hrms/lifecycleStore.server'
import { listAppraisals } from '@/lib/hrms/performanceAppraisalStore.server'
import { employeeHistory } from '@/lib/hrms/employeeHistory'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
const id = 'a'.repeat(24), manager = 'b'.repeat(24)
const request = () => GET(new Request(`https://talio.test/api/employees/${id}/history`), { params: Promise.resolve({ id }) })
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'admin', _id: manager }, tenant: { databaseName: 'test' } })
  getLifecycleDatabase.mockResolvedValue(workflowStore({ employees: [{ _id: id, status: 'active' }] }))
  listAppraisals.mockResolvedValue({ data: [] })
})
test('unauthorized and unrelated managers cannot read history', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false })
  expect((await request()).status).toBe(401)
  getAuthAndDatabase.mockResolvedValueOnce({ success: true, user: { role: 'manager', employeeId: manager } })
  expect((await request()).status).toBe(403)
  expect(listAppraisals).not.toHaveBeenCalled()
})
test('history is read only and missing onboarding is unknown, not complete', async () => {
  const response = await request(), body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data.progress).toBeNull()
  expect(body.data.events).toEqual([])
  expect(response.headers.get('Cache-Control')).toContain('no-store')
})
test('confidential workflows are hidden from a direct-report manager', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'manager', _id: manager, employeeId: manager } })
  getLifecycleDatabase.mockResolvedValue(workflowStore({ employees: [{ _id: id, reportingManager: manager }], hrmsworkflows: [{ _id: 'secret', subjectEmployee: id, confidential: true, title: 'Secret case' }, { _id: 'visible', subjectEmployee: id, confidential: false, title: 'Onboarding' }] }))
  const response = await request(), body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data.events.map(row => row.title)).toEqual(['Onboarding'])
})
test('chronological events preserve PIP decisions and appraisal history without private evidence', () => {
  const events = employeeHistory({ dateOfJoining: '2025-01-01', lifecycle: { probation: { pip: { enabled: true, goals: 'Complete training' }, extendedAt: '2026-01-02' }, onboarding: { checklist: [{ key: 'bank', label: 'Bank verified', completed: true, submission: { accountNumber: 'SECRET' } }] } } }, [{ _id: 'p', pip: { enabled: true }, createdAt: '2026-01-01', decidedAt: '2026-01-02', status: 'approved' }], [{ _id: 'a', reviewPeriod: 'Q1', createdAt: '2026-03-01', timeline: [{ type: 'approved', at: '2026-03-02', message: 'Reviewed' }] }])
  expect(events[0].title).toBe('Appraisal · approved')
  expect(events.filter(row => row.category === 'pip')).toHaveLength(3)
  expect(events.at(-1).at).toBeNull()
  expect(JSON.stringify(events)).not.toContain('SECRET')
  expect(events.some(row => row.category === 'promotion')).toBe(false)
})
