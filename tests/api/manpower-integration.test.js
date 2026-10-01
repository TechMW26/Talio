import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { getTenantConnection } from '@/lib/tenantDb'
import { getTenantModels } from '@/lib/tenantModels'
import { getAuthAndModels } from '@/lib/auth'
import { GET, POST } from '@/app/api/recruitment/requisitions/route'
import { reviewManpower } from '@/lib/recruitment/manpower.server'
import { serializeJob } from '@/lib/recruitment/wordpress.server'
jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRecruitmentUpdate: jest.fn() }))
let replica, connection, models, manager, hr, department, body
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  connection = await mongoose.createConnection(replica.getUri()).asPromise()
  getTenantConnection.mockResolvedValue(connection)
  models = await getTenantModels('manpower-integration', ['ManpowerRequest', 'JobPosting', 'Notification', 'Department', 'User', 'Employee'])
  await Promise.all(Object.values(models).map(model => model.init()))
}, 120000)
afterAll(async () => { await connection?.close(); await replica?.stop() })
beforeEach(async () => {
  await Promise.all(['ManpowerRequest', 'JobPosting', 'Notification', 'Department', 'User', 'Employee'].map(name => models[name].deleteMany({})))
  const oid = () => new mongoose.Types.ObjectId()
  manager = { _id: oid(), employeeId: oid(), email: 'manager@example.test', role: 'manager', isActive: true }
  hr = { _id: oid(), employeeId: oid(), email: 'hr@example.test', role: 'hr', isActive: true }
  department = oid()
  await models.User.collection.insertMany([manager, hr])
  await models.Employee.collection.insertMany([{ _id: manager.employeeId, employeeCode: 'TEST1', email: manager.email, status: 'active' }, { _id: hr.employeeId, employeeCode: 'TEST2', email: hr.email, status: 'active' }])
  await models.Department.collection.insertOne({ _id: department, name: 'Engineering', isActive: true })
  getAuthAndModels.mockResolvedValue({ success: true, user: manager, models })
  body = { action: 'submit', submissionKey: 'unique-request-key-1234', department: String(department), jobTitle: 'Engineer', jobDescription: 'Build software and collaborate with the product team.', justification: 'Additional capacity for new projects', numberOfPositions: 2, location: 'Bhopal', employmentType: 'full-time', workMode: 'hybrid', experienceMin: 1, experienceMax: 4, salaryMin: 400000, salaryMax: 800000, currency: 'INR', requirements: ['Experience'], responsibilities: ['Build software'], skills: ['JavaScript'], benefits: ['Learning budget'] }
})
const submit = () => POST(new Request('https://test/api/recruitment/requisitions', { method: 'POST', body: JSON.stringify(body) }))
test('dashboard statistics and status filters share the requester access scope across pages', async () => {
  const own = Array.from({ length: 23 }, (_, index) => ({ requestedBy: manager._id, submissionKey: `dashboard-fixture-${index}`, employee: manager.employeeId, department, status: index < 21 ? 'pending' : 'approved', job: { jobTitle: `Role ${index}` }, createdAt: new Date() }))
  await models.ManpowerRequest.collection.insertMany([...own, { requestedBy: hr._id, employee: hr.employeeId, department, status: 'rejected', job: { jobTitle: 'Private HR request' } }])
  const request = query => GET(new Request(`https://test/api/recruitment/requisitions?${query}`))
  const result = await (await request('status=pending&page=2')).json()
  expect(result.stats).toEqual({ all: 23, pending: 21, approved: 2, rejected: 0 })
  expect(result.total).toBe(21)
  expect(result.data).toHaveLength(1)
  expect(result.data[0].status).toBe('pending')
  expect((await request('status=unknown')).status).toBe(400)
  getAuthAndModels.mockResolvedValue({ success: true, user: hr, models })
  const reviewed = await (await request('status=rejected')).json()
  expect(reviewed.stats).toEqual({ all: 24, pending: 21, approved: 2, rejected: 1 })
  expect(reviewed.total).toBe(1)
})
test('concurrent HTTP retries create one request and one HR notification', async () => {
  const responses = await Promise.all([submit(), submit()])
  expect(responses.map(response => response.status)).toEqual([200, 200])
  expect(await models.ManpowerRequest.countDocuments()).toBe(1)
  expect(await models.Notification.countDocuments()).toBe(1)
})
test('real tenant models persist request, approve once under concurrency, and serialize for WordPress', async () => {
  const response = await submit()
  expect(response.status).toBe(200)
  const requestId = (await response.json()).data.id
  expect((await submit()).status).toBe(200)
  expect(await models.ManpowerRequest.countDocuments()).toBe(1)
  expect(await models.Notification.countDocuments()).toBe(1)
  const results = await Promise.all([reviewManpower(models, hr, { id: requestId, action: 'approve' }), reviewManpower(models, hr, { id: requestId, action: 'approve' })])
  expect(results.map(result => result.repeated).sort()).toEqual([false, true])
  expect(await models.JobPosting.countDocuments()).toBe(1)
  expect(await models.Notification.countDocuments()).toBe(2)
  const job = await models.JobPosting.findById(requestId).lean()
  expect(job.status).toBe('open')
  expect(serializeJob(job)).toMatchObject({ title: 'Engineer', status: 'open', skills: ['JavaScript'], responsibilities: ['Build software'] })
  expect(serializeJob(job)).not.toHaveProperty('salaryRange')
  expect(serializeJob(job)).not.toHaveProperty('justification')
}, 30000)
test('transaction rolls back both publication and approval if notification persistence fails', async () => {
  const id = (await (await submit()).json()).data.id
  const create = jest.spyOn(models.Notification, 'create').mockRejectedValueOnce(new Error('Simulated write failure'))
  await expect(reviewManpower(models, hr, { id, action: 'approve' })).rejects.toThrow('Simulated write failure')
  create.mockRestore()
  expect(await models.JobPosting.countDocuments()).toBe(0)
  expect((await models.ManpowerRequest.findById(id).lean()).status).toBe('pending')
  expect((await reviewManpower(models, hr, { id, action: 'approve' })).record.status).toBe('approved')
})
