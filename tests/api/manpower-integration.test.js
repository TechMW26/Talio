import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getManpowerStore } from '@/lib/recruitment/manpowerStore.server'
import { GET, POST } from '@/app/api/recruitment/requisitions/route'
import { reviewManpower } from '@/lib/recruitment/manpower.server'
import { serializeJob } from '@/lib/recruitment/wordpress.server'
import { randomBytes } from 'node:crypto'
jest.setTimeout(45000)
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/recruitment/manpowerStore.server', () => ({ ...jest.requireActual('@/lib/recruitment/manpowerStore.server'), getManpowerStore: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRecruitmentUpdate: jest.fn() }))
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native manpower workflow against isolated Firestore emulator', () => {
let firestore, store, manager, hr, department, body
const oid = () => randomBytes(12).toString('hex')
beforeAll(() => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
  firestore = new Firestore({ projectId: 'demo-talio-firestore' })
})
afterAll(async () => { await firestore?.terminate() })
beforeEach(async () => {
  store = createFirestoreDatabase({ firestore, dataset: `test-manpower-${Date.now()}-${oid()}`, databaseName: 'talio_company_test',
    queryFields: { manpowerrequests: ['requestedBy', 'submissionKey', 'status', 'createdAt'], users: ['role'], departments: ['name'] },
    constraints: { manpowerrequests: [{ fields: ['requestedBy', 'submissionKey'], sparse: true }] },
  })
  manager = { _id: oid(), employeeId: oid(), email: 'manager@example.test', role: 'manager', isActive: true }
  hr = { _id: oid(), employeeId: oid(), email: 'hr@example.test', role: 'hr', isActive: true }
  department = oid()
  for (const user of [manager, hr]) { await store.create('users', user); await store.create('employees', { _id: user.employeeId, employeeCode: user.role, email: user.email, status: 'active' }) }
  await store.create('departments', { _id: department, name: 'Engineering', isActive: true })
  getAuthAndDatabase.mockResolvedValue({ success: true, user: manager, tenant: { databaseName: store.databaseName } })
  getManpowerStore.mockResolvedValue(store)
  body = { action: 'submit', submissionKey: 'unique-request-key-1234', department, jobTitle: 'Engineer', jobDescription: 'Build software and collaborate with the product team.', justification: 'Additional capacity for new projects', numberOfPositions: 2, location: 'Bhopal', employmentType: 'full-time', workMode: 'hybrid', experienceMin: 1, experienceMax: 4, salaryMin: 400000, salaryMax: 800000, currency: 'INR', requirements: ['Experience'], responsibilities: ['Build software'], skills: ['JavaScript'], benefits: ['Learning budget'] }
})
const submit = () => POST(new Request('https://test/api/recruitment/requisitions', { method: 'POST', body: JSON.stringify(body) }))
test('dashboard statistics and status filters share the requester access scope across pages', async () => {
  const own = Array.from({ length: 23 }, (_, index) => ({ requestedBy: manager._id, submissionKey: `dashboard-fixture-${index}`, employee: manager.employeeId, department, status: index < 21 ? 'pending' : 'approved', job: { jobTitle: `Role ${index}` }, createdAt: new Date() }))
  for (const record of [...own, { requestedBy: hr._id, employee: hr.employeeId, department, status: 'rejected', job: { jobTitle: 'Private HR request' }, createdAt: new Date() }]) await store.create('manpowerrequests', { _id: oid(), ...record })
  const request = query => GET(new Request(`https://test/api/recruitment/requisitions?${query}`))
  const result = await (await request('status=pending&page=2')).json()
  expect(result.stats).toEqual({ all: 23, pending: 21, approved: 2, rejected: 0 })
  expect(result.total).toBe(21)
  expect(result.data).toHaveLength(1)
  expect(result.data[0].status).toBe('pending')
  expect((await request('status=unknown')).status).toBe(400)
  getAuthAndDatabase.mockResolvedValue({ success: true, user: hr, tenant: { databaseName: store.databaseName } })
  const reviewed = await (await request('status=rejected')).json()
  expect(reviewed.stats).toEqual({ all: 24, pending: 21, approved: 2, rejected: 1 })
  expect(reviewed.total).toBe(1)
})
test('concurrent HTTP retries create one request and one HR notification', async () => {
  const responses = await Promise.all([submit(), submit()])
  expect(responses.map(response => response.status)).toEqual([200, 200])
  expect(await store.count('manpowerrequests')).toBe(1)
  expect(await store.count('notifications')).toBe(1)
})
test('native tenant store persists request, approves once under concurrency, and serializes for WordPress', async () => {
  const response = await submit()
  expect(response.status).toBe(200)
  const requestId = (await response.json()).data.id
  expect((await submit()).status).toBe(200)
  expect(await store.count('manpowerrequests')).toBe(1)
  expect(await store.count('notifications')).toBe(1)
  const results = await Promise.all([reviewManpower(store, hr, { id: requestId, action: 'approve' }), reviewManpower(store, hr, { id: requestId, action: 'approve' })])
  expect(results.map(result => result.repeated).sort()).toEqual([false, true])
  expect(await store.count('jobpostings')).toBe(1)
  expect(await store.count('notifications')).toBe(2)
  const job = await store.get('jobpostings', requestId)
  expect(job.status).toBe('open')
  expect(serializeJob(job)).toMatchObject({ title: 'Engineer', status: 'open', skills: ['JavaScript'], responsibilities: ['Build software'] })
  expect(serializeJob(job)).not.toHaveProperty('salaryRange')
  expect(serializeJob(job)).not.toHaveProperty('justification')
}, 30000)
test('transaction rolls back both publication and approval if notification persistence fails', async () => {
  const id = (await (await submit()).json()).data.id
  const failing = { ...store, transaction: callback => store.transaction(tx => callback({ ...tx, create: (name, record) => name === 'notifications' ? Promise.reject(new Error('Simulated write failure')) : tx.create(name, record) })) }
  await expect(reviewManpower(failing, hr, { id, action: 'approve' })).rejects.toThrow('Simulated write failure')
  expect(await store.count('jobpostings')).toBe(0)
  expect((await store.get('manpowerrequests', id)).status).toBe('pending')
  expect((await reviewManpower(store, hr, { id, action: 'approve' })).record.status).toBe('approved')
})

})
