import { validateManpower, canRequestManpower, reviewManpower } from '@/lib/recruitment/manpower.server'
import { GET, POST } from '@/app/api/recruitment/requisitions/route'
import { getAuthAndModels } from '@/lib/auth'
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRecruitmentUpdate: jest.fn() }))
const hr = { _id: '111111111111111111111111', role: 'hr', employeeId: '222222222222222222222222' }
const manager = { _id: '333333333333333333333333', role: 'manager', employeeId: '444444444444444444444444' }
const input = () => ({ department: '555555555555555555555555', jobTitle: 'Engineer', jobDescription: 'Build and maintain our software products.', justification: 'New customer delivery team requires additional capacity.', location: 'Bhopal', numberOfPositions: 2, employmentType: 'full-time', workMode: 'hybrid', educationLevel: 'bachelor', experienceMin: 2, experienceMax: 5, salaryMin: 500000, salaryMax: 900000, currency: 'INR', requirements: ['Engineering experience'], responsibilities: ['Build applications'], skills: ['JavaScript'], benefits: [], submissionKey: 'test-request-key-1234', action: 'submit' })
const query = data => ({ select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(data) })
let actor, record, models, session
beforeEach(() => {
  jest.clearAllMocks()
  actor = manager
  record = { _id: '666666666666666666666666', requestedBy: manager._id, employee: manager.employeeId, department: input().department, job: validateManpower(input()).job, status: 'pending' }
  session = { withTransaction: jest.fn(async fn => fn()), endSession: jest.fn() }
  models = {
    User: { findById: jest.fn(() => query(actor)), find: jest.fn(() => query([hr])) },
    Department: { find: jest.fn(() => query([{ _id: input().department, name: 'Technology' }])), findById: jest.fn(() => query({ _id: input().department, isActive: true })), exists: jest.fn().mockResolvedValue(null) },
    Employee: { findById: jest.fn(() => query({ _id: manager.employeeId, status: 'active' })) },
    ManpowerRequest: { collection: { createIndex: jest.fn() }, db: { startSession: jest.fn().mockResolvedValue(session) }, find: jest.fn(() => query([record])), countDocuments: jest.fn().mockResolvedValue(1), findOne: jest.fn(() => query(null)), findById: jest.fn(() => query(record)), create: jest.fn(async docs => docs), findOneAndUpdate: jest.fn((filter, update) => query({ ...record, ...update.$set })) },
    JobPosting: { create: jest.fn().mockResolvedValue([]), findById: jest.fn(() => query({})) },
    Notification: { create: jest.fn().mockResolvedValue([]) },
  }
  getAuthAndModels.mockImplementation(async () => ({ success: true, user: { _id: actor._id }, models }))
})
const request = body => ({ url: 'https://test/api/recruitment/requisitions', json: async () => body })
test.each(['manager', 'team_leader', 'department_head', 'hr', 'admin'])('%s may request manpower', role => expect(canRequestManpower({ role })).toBe(true))
test('employee cannot request unless assigned leadership', () => {
  expect(canRequestManpower({ role: 'employee' })).toBe(false)
  expect(canRequestManpower({ role: 'employee', teamLeaderOf: ['team'] })).toBe(true)
})
test.each([{ numberOfPositions: 0 }, { numberOfPositions: 1.2 }, { numberOfPositions: '2' }, { salaryMin: -1 }, { salaryMax: 1 }, { experienceMax: 1 }, { department: { $ne: null } }, { requirements: [] }, { jobDescription: 'Short' }, { currency: '123' }])('validates invalid fields %j', bad => expect(() => validateManpower({ ...input(), ...bad })).toThrow())
test('only allowed public job fields survive input validation', () => {
  const result = validateManpower({ ...input(), status: 'open', createdBy: 'attacker', jobCode: 'bad' })
  expect(result.job.status).toBeUndefined()
  expect(result.job.justification).toBeUndefined()
  expect(result.job.salaryRange.isConfidential).toBe(true)
})
test('GET is scoped to requester for managers, HR sees tenant inbox', async () => {
  await GET(request())
  expect(models.ManpowerRequest.find).toHaveBeenLastCalledWith({ requestedBy: manager._id })
  actor = hr; await GET(request())
  expect(models.ManpowerRequest.find).toHaveBeenLastCalledWith({})
})
test('server resolves department authority when session role is employee', async () => {
  actor = { ...manager, role: 'employee' }; models.Department.exists.mockResolvedValue({ _id: 'dept' })
  expect((await GET(request())).status).toBe(200)
})
test('unauthenticated, inactive and ordinary employees cannot access', async () => {
  getAuthAndModels.mockResolvedValueOnce({ success: false, status: 401 })
  expect((await GET(request())).status).toBe(401)
  actor = { ...manager, isActive: false }; expect((await POST(request(input()))).status).toBe(403)
  actor = { ...manager, role: 'employee' }; expect((await GET(request())).status).toBe(403)
})
test('submission and HR notifications share transaction and authoritative identity', async () => {
  expect((await POST(request({ ...input(), requestedBy: 'attacker' }))).status).toBe(200)
  expect(models.ManpowerRequest.create).toHaveBeenCalledWith([expect.objectContaining({ requestedBy: manager._id, employee: manager.employeeId })], { session })
  expect(models.Notification.create).toHaveBeenCalledWith([expect.objectContaining({ user: hr._id })], { session })
  expect(models.JobPosting.create).not.toHaveBeenCalled()
  expect(session.endSession).toHaveBeenCalled()
})
test('repeat submission returns existing request without duplicate notification', async () => {
  models.ManpowerRequest.findOne.mockImplementation(() => query(record))
  expect((await POST(request(input()))).status).toBe(200)
  expect(models.ManpowerRequest.create).not.toHaveBeenCalled()
  expect(models.Notification.create).not.toHaveBeenCalled()
})
test('HR approval creates complete open job with pipeline atomically', async () => {
  const result = await reviewManpower(models, hr, { id: record._id, action: 'approve' })
  expect(result.record.status).toBe('approved')
  expect(models.JobPosting.create).toHaveBeenCalledWith([expect.objectContaining({ ...record.job, _id: record._id, status: 'open', hiringManager: manager.employeeId, hiringPipeline: expect.arrayContaining([expect.objectContaining({ stageName: 'Applied' })]) })], { session })
  expect(models.ManpowerRequest.findOneAndUpdate).toHaveBeenCalledWith({ _id: record._id, status: 'pending' }, expect.anything(), expect.objectContaining({ session }))
})
test('repeated approval returns original job and does not publish again', async () => {
  record.status = 'approved'; record.jobPosting = record._id
  expect((await reviewManpower(models, hr, { id: record._id, action: 'approve' })).repeated).toBe(true)
  expect(models.JobPosting.create).not.toHaveBeenCalled()
})
test('rejection needs reason, notifies requester and never publishes', async () => {
  await expect(reviewManpower(models, hr, { id: record._id, action: 'reject' })).rejects.toThrow('reason')
  expect((await reviewManpower(models, hr, { id: record._id, action: 'reject', reason: 'Budget not approved' })).record.status).toBe('rejected')
  expect(models.JobPosting.create).not.toHaveBeenCalled()
})
test('managers, self reviewers, stale requests and cross-tenant IDs are rejected', async () => {
  await expect(reviewManpower(models, manager, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 403 })
  await expect(reviewManpower(models, { ...hr, _id: manager._id }, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 403 })
  record.status = 'rejected'
  await expect(reviewManpower(models, hr, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 409 })
  models.ManpowerRequest.findById.mockImplementation(() => query(null))
  await expect(reviewManpower(models, hr, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 404 })
})
test('publication failure propagates out of transaction for rollback, session closes', async () => {
  models.JobPosting.create.mockRejectedValue(new Error('Database failure'))
  await expect(reviewManpower(models, hr, { id: record._id, action: 'approve' })).rejects.toThrow('Database failure')
  expect(models.ManpowerRequest.findOneAndUpdate).not.toHaveBeenCalled()
  expect(session.endSession).toHaveBeenCalled()
})
