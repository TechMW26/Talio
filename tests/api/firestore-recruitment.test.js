import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { RECRUITMENT_STORE_OPTIONS, saveJob, saveCandidate, saveInterview, deleteRecruitmentRecord, listRecruitment } from '@/lib/recruitment/store.server'
import { recruitmentAnalytics } from '@/lib/recruitment/analytics.server'
import { importLinkedInProfile } from '@/lib/linkedinSync'

jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native recruitment', () => {
  let firestore, database, job
  const actor = { _id: '111111111111111111111111', employeeId: '222222222222222222222222', role: 'hr' }
  const department = '333333333333333333333333'
  const candidate = () => saveCandidate(database, { firstName: 'Ada', lastName: 'Test', email: 'ada@example.test', jobPosting: job._id }, actor)
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore?.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-recruitment-${Date.now()}-${randomBytes(4).toString('hex')}`, databaseName: 'talio_company_test', ...RECRUITMENT_STORE_OPTIONS })
    await database.create('departments', { _id: department, name: 'Engineering' })
    await database.create('employees', { _id: actor.employeeId, firstName: 'Test', lastName: 'Manager', status: 'active' })
    job = await saveJob(database, { jobTitle: 'Platform Engineer', jobDescription: 'Build software', department, status: 'open' }, actor)
  })
  test('concurrent candidate submissions create one candidate', async () => {
    const results = await Promise.all([candidate(), candidate()])
    expect(results.filter(row => row.created)).toHaveLength(1)
    expect(results.filter(row => row.existed)).toHaveLength(1)
    expect(await database.count('candidates')).toBe(1)
  })
  test('scheduling updates candidate stage and assigns consecutive rounds atomically', async () => {
    const { candidate: person } = await candidate()
    const input = { candidate: person._id, jobPosting: job._id, scheduledDate: '2026-11-01T10:00:00Z', interviewers: [actor.employeeId] }
    const records = await Promise.all([saveInterview(database, input, actor), saveInterview(database, input, actor)])
    expect(records.map(row => row.round).sort()).toEqual([1, 2])
    expect((await database.get('candidates', person._id)).stage).toBe('interview')
    expect((await database.get('candidates', person._id)).stageHistory).toHaveLength(2)
  })
  test('feedback only allowed for assigned interviewer and automatically completes', async () => {
    const { candidate: person } = await candidate()
    const interview = await saveInterview(database, { candidate: person._id, jobPosting: job._id, scheduledDate: '2026-11-01', interviewers: [actor.employeeId] }, actor)
    await expect(saveInterview(database, { feedback: { rating: 5 } }, { _id: '444444444444444444444444', role: 'employee' }, interview._id)).rejects.toMatchObject({ status: 403 })
    const done = await saveInterview(database, { feedback: { rating: 5, recommendation: 'hire' } }, { ...actor, role: 'employee' }, interview._id)
    expect(done.status).toBe('completed')
  })
  test('interview failure rolls back stage and interview', async () => {
    const { candidate: person } = await candidate()
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, replace: (name, record) => name === 'candidates' ? Promise.reject(new Error('fail')) : tx.replace(name, record) })) }
    await expect(saveInterview(failing, { candidate: person._id, jobPosting: job._id, scheduledDate: '2026-11-01', interviewers: [actor.employeeId] }, actor)).rejects.toThrow('fail')
    expect(await database.count('interviews')).toBe(0)
    expect((await database.get('candidates', person._id)).stage).toBe('applied')
  })
  test('deletes linked records together and search uses native projection', async () => {
    const { candidate: person } = await candidate()
    await saveInterview(database, { candidate: person._id, jobPosting: job._id, scheduledDate: '2026-11-01', interviewers: [actor.employeeId] }, actor)
    expect((await listRecruitment(database, 'jobpostings', new URLSearchParams({ search: 'atform' }), actor)).data).toHaveLength(1)
    await deleteRecruitmentRecord(database, 'jobpostings', job._id)
    expect(await database.count('candidates')).toBe(0)
    expect(await database.count('interviews')).toBe(0)
  })
  test('department analytics scopes every total consistently', async () => {
    await candidate()
    const report = await recruitmentAnalytics(database, department)
    expect(report.overview).toMatchObject({ totalJobs: 1, totalCandidates: 1, totalInterviews: 0, openJobs: 1 })
    expect(report.pipeline.applied).toBe(1)
    expect((await recruitmentAnalytics(database, '444444444444444444444444')).overview).toMatchObject({ totalJobs: 0, totalCandidates: 0 })
  })
  test('LinkedIn import uses native repository and refreshes without duplicating notes or candidates', async () => {
    const options = { database, jobId: job._id, actorId: actor.employeeId, profileData: { firstName: 'Grace', lastName: 'Test', email: 'grace@example.test', skills: ['JS'] } }
    const first = await importLinkedInProfile('talio_company_test', options)
    expect(first.status).toBe('created')
    const second = await importLinkedInProfile('talio_company_test', { ...options, profileData: { ...options.profileData, skills: ['TS'] } })
    expect(second.status).toBe('updated')
    expect(second.candidate.skills).toEqual(['JS', 'TS'])
    expect(second.candidate.notes).toHaveLength(1)
    expect(await database.count('candidates')).toBe(1)
  })
})
