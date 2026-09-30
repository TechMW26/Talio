import { actionsFor, transition, reasonText, publicResignation, resolveReviewers, notifyResignation } from '@/lib/hrms/resignation.server'
import { GET, POST } from '@/app/api/resignations/route'
import { getAuthAndModels } from '@/lib/auth'
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))

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
const query = value => ({ select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) })
let models, actor, record
beforeEach(() => {
  jest.clearAllMocks(); actor = employee; record = base()
  models = {
    User: { findById: jest.fn(() => query(actor)), find: jest.fn(() => query([hr])) },
    Employee: { findById: jest.fn(() => query({ _id: employee.employeeId, status: 'active', assignedManager: 'cccccccccccccccccccccccc' })) },
    Department: { find: jest.fn(() => query([])) },
    ResignationRequest: { collection: { createIndex: jest.fn() }, find: jest.fn(() => query([record])), findById: jest.fn(() => query(record)), create: jest.fn(async data => ({ ...base(), ...data })), findOneAndUpdate: jest.fn(() => query({ ...record, status: 'withdrawn' })) },
    Notification: { create: jest.fn().mockResolvedValue({}) },
  }
  getAuthAndModels.mockImplementation(async () => ({ success: true, user: { _id: actor._id }, models, tenant: { databaseName: 'test-tenant' } }))
})
const request = body => ({ json: async () => body })
test('submission uses authenticated employee, not client-supplied identity', async () => {
  const response = await POST(request({ action: 'submit', employee: 'other', reason: 'Personal relocation' }))
  expect(response.status).toBe(200)
  expect(models.ResignationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ employee: employee.employeeId, requestedBy: employee._id, status: 'hr_review' }))
  expect(models.ResignationRequest.collection.createIndex).toHaveBeenCalledWith({ employee: 1 }, expect.objectContaining({ unique: true }))
})
test('unauthenticated requests fail', async () => {
  getAuthAndModels.mockResolvedValue({ success: false, status: 401 })
  expect((await GET({})).status).toBe(401)
  expect((await POST(request({}))).status).toBe(401)
})
test('inactive users cannot access requests', async () => {
  actor = { ...employee, isActive: false }
  expect((await GET({})).status).toBe(403)
})
test('list query is scoped to requester and assigned reviewer', async () => {
  await GET({})
  expect(models.ResignationRequest.find).toHaveBeenCalledWith({ $or: [{ requestedBy: employee._id }, { reviewers: employee._id }] })
})
test('unrelated user cannot read or act on a guessed request', async () => {
  actor = stranger
  expect((await POST(request({ id: record._id, version: 0, action: 'withdraw' }))).status).toBe(404)
})
test('stale and simultaneous updates fail with conflict', async () => {
  expect((await POST(request({ id: record._id, version: 1, action: 'withdraw' }))).status).toBe(409)
  models.ResignationRequest.findOneAndUpdate.mockReturnValue(query(null))
  expect((await POST(request({ id: record._id, version: 0, action: 'withdraw' }))).status).toBe(409)
  expect(models.ResignationRequest.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: record._id, version: 0, status: 'hr_review' })
})
test('duplicate active request returns conflict', async () => {
  models.ResignationRequest.create.mockRejectedValue({ code: 11000 })
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(409)
})
test('missing hierarchy does not skip approval stage', async () => {
  actor = hr; models.User.find.mockReturnValue(query([]))
  expect((await POST(request({ id: record._id, version: 0, action: 'approve' }))).status).toBe(409)
  expect(models.ResignationRequest.findOneAndUpdate).not.toHaveBeenCalled()
})
test('notification failure does not report a saved request as failed', async () => {
  models.Notification.create.mockRejectedValue(new Error('Unavailable'))
  const response = await POST(request({ action: 'submit', reason: 'Personal relocation' }))
  expect(response.status).toBe(200)
  expect((await response.json()).message).toContain('Some notifications')
})
test('acceptance notifies HR, hierarchy and employee', async () => {
  await notifyResignation(models, { ...record, status: 'accepted' }, [hr._id])
  expect(models.Notification.create.mock.calls.map(([item]) => item.user).sort()).toEqual([employee._id, hr._id, manager._id].sort())
})
test('employee does not see an unrelayed proposal, including during renegotiation', () => {
  const r = { ...base(), status: 'hr_relay', proposal: { noticeDays: 15 }, timeline: [{ action: 'propose', noticeDays: 30 }, { action: 'relay' }, { action: 'negotiate' }, { action: 'propose', noticeDays: 15 }] }
  expect(publicResignation(r, employee).proposal).toBeNull()
  expect(publicResignation(r, employee).timeline).toHaveLength(3)
  expect(publicResignation(r, hr).proposal.noticeDays).toBe(15)
  expect(publicResignation({ ...r, status: 'employee_review', timeline: [...r.timeline, { action: 'relay' }] }, employee).proposal.noticeDays).toBe(15)
})
test('reviewer discovery uses tenant hierarchy and excludes self', async () => {
  models.Department.find.mockReturnValue(query([{ head: 'dddddddddddddddddddddddd', heads: ['eeeeeeeeeeeeeeeeeeeeeeee'] }]))
  models.User.find.mockReturnValue(query([manager]))
  expect(await resolveReviewers(models, { _id: employee.employeeId, department: 'ffffffffffffffffffffffff', assignedManager: 'cccccccccccccccccccccccc', assignedTeamLead: employee.employeeId }, employee._id)).toEqual([manager._id])
  expect(models.User.find).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: employee._id }, employeeId: { $in: ['cccccccccccccccccccccccc', 'dddddddddddddddddddddddd', 'eeeeeeeeeeeeeeeeeeeeeeee'] } }))
})
test('submission requires independent HR and rejects inactive employee profiles', async () => {
  models.User.find.mockReturnValue(query([employee]))
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(409)
  models.User.find.mockReturnValue(query([hr]))
  models.Employee.findById.mockReturnValue(query({ status: 'resigned' }))
  expect((await POST(request({ action: 'submit', reason: 'Personal relocation' }))).status).toBe(403)
})
test('malformed JSON and null body return validation errors', async () => {
  expect((await POST({ json: async () => { throw new Error('JSON') } })).status).toBe(400)
  expect((await POST(request(null))).status).toBe(400)
})
