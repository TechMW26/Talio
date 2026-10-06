jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/projectNotifications', () => ({ notifyProjectApproved: jest.fn(), notifyProjectRejected: jest.fn(), getProjectMemberUserIds: jest.fn(async () => []) }))
jest.mock('@/lib/projectEmailNotifications', () => ({}))
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getAuthAndDatabase } from '@/lib/auth'
import { PROJECT_STORE_OPTIONS } from '@/lib/projects.server'
import { respondToCompletionApproval } from '@/lib/projectService'
import { PUT } from '@/app/api/projects/[projectId]/approval/route'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('project completion approval permissions on native Firestore', () => {
  let firestore, database
  const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaa', employeeId = 'bbbbbbbbbbbbbbbbbbbbbbbb', approvalId = 'cccccccccccccccccccccccc'
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-completion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_completion', ...PROJECT_STORE_OPTIONS })
    getFirestoreTenantDatabase.mockResolvedValue(database)
    await database.create('projects', { _id: projectId, name: 'Fixture', projectHead: 'legacy-head', projectHeads: ['legacy-head', employeeId], status: 'completed_pending_approval' })
    await database.create('projectcompletionapprovals', { _id: approvalId, project: projectId, projectHead: 'legacy-head', status: 'pending' })
    await database.create('employees', { _id: employeeId, firstName: 'Secondary', lastName: 'Head', status: 'active' })
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', userId: 'user', employeeId, role: 'employee' }, tenant: { databaseName: database.databaseName }, database })
  })
  afterAll(async () => { await firestore?.terminate() })
  test('secondary projectHeads entry may approve and both records persist atomically', async () => {
    const result = await respondToCompletionApproval(approvalId, { _id: employeeId }, true, 'Looks good', false, database)
    expect(result.project.status).toBe('completed')
    expect(await database.get('projectcompletionapprovals', approvalId)).toMatchObject({ status: 'approved', respondedBy: employeeId })
    expect((await database.get('projects', projectId)).status).toBe('completed')
  })
  test('accepted head membership may approve even if old head fields differ', async () => {
    await database.mutate('projects', projectId, row => ({ ...row, projectHeads: [] }))
    await database.create('projectmembers', { _id: 'member', project: projectId, user: employeeId, role: 'head', invitationStatus: 'accepted' })
    expect((await respondToCompletionApproval(approvalId, { _id: employeeId }, true, '', false, database)).approval.status).toBe('approved')
  })
  test('pending head invitation grants no approval authority and rolls back', async () => {
    await database.mutate('projects', projectId, row => ({ ...row, projectHeads: [] }))
    await database.create('projectmembers', { _id: 'member', project: projectId, user: employeeId, role: 'head', invitationStatus: 'pending' })
    await expect(respondToCompletionApproval(approvalId, { _id: employeeId }, true, '', false, database)).rejects.toMatchObject({ status: 403 })
    expect((await database.get('projectcompletionapprovals', approvalId)).status).toBe('pending')
  })
  test('PUT delegates validated project scope to native approval workflow', async () => {
    const response = await PUT(new Request(`http://localhost/api/projects/${projectId}/approval`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalId, action: 'approve', remark: 'Approved' }) }), { params: Promise.resolve({ projectId }) })
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true })
    expect((await database.get('projectcompletionapprovals', approvalId)).respondedBy).toBe(employeeId)
  })
  test('simultaneous response is single use', async () => {
    const results = await Promise.allSettled([true, false].map(approve => respondToCompletionApproval(approvalId, { _id: employeeId }, approve, '', false, database)))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('projecttimelineevents')).toBe(1)
  })
})
