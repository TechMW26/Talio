import { actionsFor, transition, reasonText, publicResignation, resolveReviewers, notifyResignation } from '@/lib/hrms/resignation.server'
import { GET, POST } from '@/app/api/resignations/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getResignationStore } from '@/lib/hrms/resignationStore.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
jest.mock('@/lib/hrms/resignationStore.server', () => ({ ...jest.requireActual('@/lib/hrms/resignationStore.server'), getResignationStore: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))

const employee = { _id: '111111111111111111111111', role: 'employee', employeeId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
const hr = { _id: '222222222222222222222222', role: 'hr' }
const manager = { _id: '333333333333333333333333', role: 'manager' }
const stranger = { _id: '444444444444444444444444', role: 'manager' }
const now = new Date('2026-09-29T12:00:00Z')
const base = () => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', requestedBy: employee._id, employee: employee.employeeId, createdAt: now, status: 'hr_review', active: true, reviewers: [manager._id], version: 0, timeline: [] })
function step(record, actor, action, input = {}) { const { update, event } = transition(record, actor, { action, ...input }, now); return { ...record, ...update, timeline: [...record.timeline, event] } }

test('complete HR -> hierarchy -> HR -> employee negotiation and acceptance flow', () => {
  let r = step(base(), hr, 'approve')
  expect(r.status).toBe('hierarchy_review')
  r = step(r, manager, 'propose', { noticeDays: 30, noticeStartDate: '2026-09-29', reason: 'Handover required' })
  expect(r.proposal.lastWorkingDate.toISOString()).toBe('2026-10-29T00:00:00.000Z')
  expect(actionsFor(r, employee)).not.toContain('accept')
  r = step(r, hr, 'relay')
  r = step(r, employee, 'negotiate', { reason: 'Please reduce to 15 days for relocation' })
  expect(r.status).toBe('negotiation_hr')
  expect(actionsFor(r, manager)).toEqual([])
  r = step(r, hr, 'forward_negotiation')
  r = step(r, manager, 'propose', { noticeDays: 15, noticeStartDate: '2026-09-29', reason: 'Handover can finish earlier' })
  r = step(r, hr, 'relay')
  r = step(r, employee, 'accept')
  expect(r.status).toBe('accepted')
  expect(r.timeline).toHaveLength(8)
  expect(r.active).toBe(true)
  expect(actionsFor(r, employee)).toEqual([])
})
test.each(['approve', 'propose', 'relay', 'accept', 'negotiate'])('unassigned users cannot %s', action => {
  expect(() => transition(base(), stranger, { action }, now)).toThrow('cannot perform')
})
test('HR cannot approve their own resignation', () => {
  expect(actionsFor({ ...base(), requestedBy: hr._id }, hr)).toEqual(['withdraw'])
})
test('HR can return a proposal and employee can withdraw before acceptance', () => {
  expect(step({ ...base(), status: 'hr_relay' }, hr, 'return', { reason: 'Please reconsider the duration' }).status).toBe('hierarchy_review')
  expect(step(base(), employee, 'withdraw')).toMatchObject({ status: 'withdrawn', active: false })
  expect(step(base(), hr, 'reject', { reason: 'Please discuss this with HR first' })).toMatchObject({ status: 'rejected', active: false })
})
test.each([-1, 366, 1.5, '30', null])('invalid notice days %s are rejected', noticeDays => {
  expect(() => step({ ...base(), status: 'hierarchy_review' }, manager, 'propose', { noticeDays, noticeStartDate: '2026-09-29', reason: 'Handover period' })).toThrow('whole number')
})
test.each(['2026-02-30', '2026-09-28', 'not a date'])('invalid start date %s is rejected', noticeStartDate => {
  expect(() => step({ ...base(), status: 'hierarchy_review' }, manager, 'propose', { noticeDays: 30, noticeStartDate, reason: 'Handover period' })).toThrow()
})
test('zero-day notice is supported explicitly', () => {
  const r = step({ ...base(), status: 'hierarchy_review' }, manager, 'propose', { noticeDays: 0, noticeStartDate: '2026-09-29', reason: 'Immediate release approved' })
  expect(r.proposal.lastWorkingDate.toISOString()).toBe('2026-09-29T00:00:00.000Z')
})
test('expired proposals cannot be accepted', () => {
  expect(() => step({ ...base(), status: 'employee_review', proposal: { lastWorkingDate: new Date('2026-09-28') } }, employee, 'accept')).toThrow('expired')
})
test.each(['', '    ', 'four', 'a'.repeat(2001)])('reason is required and bounded', value => expect(() => reasonText(value)).toThrow())
let store, actor, record
beforeEach(() => {
  jest.clearAllMocks(); actor = employee; record = { ...base(), updatedAt: now }
  store = workflowStore({ users: [employee, hr, manager, stranger], employees: [{ _id: employee.employeeId, status: 'active', assignedManager: 'cccccccccccccccccccccccc' }], resignationrequests: [record] })
  getResignationStore.mockResolvedValue(store)
  getAuthAndDatabase.mockImplementation(async () => ({ success: true, user: { _id: actor._id }, tenant: { databaseName: 'talio_company_test' } }))
})
const request = body => ({ json: async () => body })
const closeExisting = () => store.mutate('resignationrequests', record._id, current => ({ ...current, active: false, status: 'withdrawn' }))
test('submission uses authenticated identity and prevents duplicate active requests', async () => {
  await closeExisting()
  const response = await POST(request({ action: 'submit', employee: 'other', reason: 'Personal relocation' }))
  expect(response.status).toBe(200)
  const created = await store.get('resignationrequests', (await response.json()).data.id)
  expect(created).toMatchObject({ employee: employee.employeeId, requestedBy: employee._id, status: 'hr_review' })
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(409)
})
test('unauthenticated requests fail', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 401 })
  expect((await GET({})).status).toBe(401)
  expect((await POST(request({}))).status).toBe(401)
})
test('inactive users cannot access requests', async () => {
  await store.mutate('users', employee._id, user => ({ ...user, isActive: false }))
  expect((await GET({})).status).toBe(403)
})
test('list uses indexed requester and assigned-reviewer scopes', async () => {
  expect((await GET({})).status).toBe(200)
  expect(store.list).toHaveBeenCalledWith('resignationrequests', expect.objectContaining({ filters: [{ field: 'requestedBy', operator: '==', value: employee._id }] }))
  expect(store.list).toHaveBeenCalledWith('resignationrequests', expect.objectContaining({ filters: [{ field: 'reviewers', operator: 'array-contains', value: employee._id }] }))
})
test('unrelated user cannot act on a guessed request', async () => {
  actor = stranger
  expect((await POST(request({ id: record._id, version: 0, action: 'withdraw' }))).status).toBe(404)
})
test('stale and simultaneous updates fail with conflict', async () => {
  expect((await POST(request({ id: record._id, version: 1, action: 'withdraw' }))).status).toBe(409)
  const responses = await Promise.all([0, 1].map(() => POST(request({ id: record._id, version: 0, action: 'withdraw' }))))
  expect(responses.map(response => response.status).sort()).toEqual([200, 409])
})
test('missing hierarchy does not skip approval stage', async () => {
  actor = hr
  expect((await POST(request({ id: record._id, version: 0, action: 'approve' }))).status).toBe(409)
  expect((await store.get('resignationrequests', record._id)).status).toBe('hr_review')
})
test('notification failure does not report a saved request as failed', async () => {
  await closeExisting()
  store.failCreate = 'notifications'
  const response = await POST(request({ action: 'submit', reason: 'Personal relocation' }))
  expect(response.status).toBe(200)
  expect((await response.json()).message).toContain('Some notifications')
})
test('acceptance notifies all appropriate users once per record version', async () => {
  await notifyResignation(store, { ...record, status: 'accepted' }, [hr._id])
  await notifyResignation(store, { ...record, status: 'accepted' }, [hr._id])
  expect((await store.list('notifications')).records.map(item => item.user).sort()).toEqual([employee._id, hr._id, manager._id].sort())
})
test('employee does not see an unrelayed proposal, including during renegotiation', () => {
  const r = { ...base(), status: 'hr_relay', proposal: { noticeDays: 15 }, timeline: [{ action: 'propose', noticeDays: 30 }, { action: 'relay' }, { action: 'negotiate' }, { action: 'propose', noticeDays: 15 }] }
  expect(publicResignation(r, employee).proposal).toBeNull()
  expect(publicResignation(r, employee).timeline).toHaveLength(3)
  expect(publicResignation(r, hr).proposal.noticeDays).toBe(15)
})
test('reviewer discovery uses explicit tenant hierarchy queries and excludes self', async () => {
  await store.mutate('users', manager._id, user => ({ ...user, employeeId: 'cccccccccccccccccccccccc' }))
  await store.create('departments', { _id: 'ffffffffffffffffffffffff', head: 'dddddddddddddddddddddddd', heads: ['eeeeeeeeeeeeeeeeeeeeeeee'] })
  expect(await resolveReviewers(store, { _id: employee.employeeId, department: 'ffffffffffffffffffffffff', assignedManager: 'cccccccccccccccccccccccc', assignedTeamLead: employee.employeeId }, employee._id)).toEqual([manager._id])
  expect(store.list).toHaveBeenCalledWith('users', expect.objectContaining({ filters: [{ field: 'employeeId', operator: 'in', value: ['cccccccccccccccccccccccc', 'dddddddddddddddddddddddd', 'eeeeeeeeeeeeeeeeeeeeeeee'] }] }))
})
test('submission requires independent HR and an active employee profile', async () => {
  await store.mutate('users', hr._id, user => ({ ...user, isActive: false }))
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(409)
  await store.mutate('users', hr._id, user => ({ ...user, isActive: true }))
  await store.mutate('employees', employee.employeeId, current => ({ ...current, status: 'resigned' }))
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(403)
})
test('malformed JSON and null body return validation errors', async () => {
  expect((await POST({ json: async () => { throw new Error('JSON') } })).status).toBe(400)
  expect((await POST(request(null))).status).toBe(400)
})
