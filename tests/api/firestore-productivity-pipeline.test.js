import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { upsertSessionFromGroup } from '@/lib/autoAnalysisTrigger'
import { cleanupExpiredScreenshotsForTenant } from '@/lib/productivityScreenshotRetention'
import { deleteScreenshots } from '@/lib/mediaStorage'
import { getProductivityEmployeeContext } from '@/lib/platform/firestoreProductivityContext.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn() }))
jest.mock('@/lib/productivityQueue', () => ({ enqueueAnalysis: jest.fn() }))
jest.mock('@/lib/dailyAnalysisRunner', () => ({ runDailyAnalysis: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ deleteScreenshots: jest.fn() }))

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
emulator('Native productivity persistence', () => {
  let firestore, store
  const databaseName = 'talio_company_productivity'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore.terminate())
  beforeEach(() => {
    jest.clearAllMocks()
    store = createFirestoreDatabase({ firestore, dataset: `test-productivity-${randomBytes(8).toString('hex')}`, databaseName, queryFields: {
      productivitysessions: ['user', 'sourceSessionId', 'date'], screenshots: ['capturedAt', 'sessionId'],
      screenshotcomposites: ['expiresAt', 'createdAt'], taskassignees: ['user', 'assignmentStatus'],
    } })
    getFirestoreTenantDatabase.mockImplementation(async name => { if (name !== databaseName) throw new Error('Wrong tenant'); return store })
    deleteScreenshots.mockResolvedValue({ successCount: 0, errorCount: 0, errors: [] })
  })
  const group = (sourceSessionId, count = 2) => {
    const screenshots = Array.from({ length: count }, (_, index) => ({ _id: `${sourceSessionId}-${index}`, capturedAt: new Date(Date.UTC(2026, 9, 3, 10, index * 4)), gridfsFileId: `media-${sourceSessionId}-${index}`, captureType: 'automatic' }))
    return { sourceSessionId, screenshots, screenshotCount: count, startTime: screenshots[0].capturedAt, endTime: screenshots.at(-1).capturedAt }
  }
  test('concurrent sessions allocate distinct sequence numbers and replay never shrinks captures', async () => {
    const [first, second] = await Promise.all(['a', 'b'].map(key => upsertSessionFromGroup({ store, userId: 'user', group: group(key) })))
    expect(new Set([first.sessionNumber, second.sessionNumber]).size).toBe(2)
    const replay = await upsertSessionFromGroup({ store, userId: 'user', group: group('a', 1) })
    expect(replay._id).toBe(first._id)
    expect(replay.screenshotCount).toBe(2)
    expect(await store.count('productivitysessions')).toBe(2)
  })
  test('analyzed sessions are immutable to late capture upserts', async () => {
    const first = await upsertSessionFromGroup({ store, userId: 'user', group: group('a') })
    await store.mutate('productivitysessions', first._id, current => ({ ...current, analysis: { isAnalyzed: true, score: 80 } }))
    const next = await upsertSessionFromGroup({ store, userId: 'user', group: group('a', 3) })
    expect(next.screenshotCount).toBe(2)
    expect(next.analysis.score).toBe(80)
  })
  test('failed Blob deletion retains metadata, fresh captures remain untouched', async () => {
    for (const [id, date] of [['old', '2026-01-01'], ['blocked', '2026-01-01'], ['fresh', '2026-10-03']]) await store.create('screenshots', { _id: id, gridfsFileId: id, capturedAt: new Date(date), user: 'user' })
    deleteScreenshots.mockImplementation(async ids => ({ successCount: ids.filter(id => id !== 'blocked').length, errors: ids.includes('blocked') ? [{ fileId: 'blocked', error: 'network' }] : [] }))
    const result = await cleanupExpiredScreenshotsForTenant({ databaseName, cutoff: new Date('2026-10-01') })
    expect(result.screenshotDocsDeleted).toBe(1)
    expect(await store.get('screenshots', 'old')).toBeNull()
    expect(await store.get('screenshots', 'blocked')).not.toBeNull()
    expect(await store.get('screenshots', 'fresh')).not.toBeNull()
  })
  test('employee context joins both historical user and employee task assignments', async () => {
    await store.create('users', { _id: 'user', employeeId: 'employee' })
    await store.create('employees', { _id: 'employee', firstName: 'Test', manualKPIs: [{ name: 'quality', target: '95' }], aiGeneratedKRIs: [{ title: 'Review', description: 'Review changes' }] })
    for (const [id, assignee] of [['first', 'user'], ['second', 'employee']]) {
      await store.create('tasks', { _id: id, title: id, status: 'todo' })
      await store.create('taskassignees', { _id: id, user: assignee, task: id, assignmentStatus: 'accepted' })
    }
    const context = await getProductivityEmployeeContext(databaseName, 'user')
    expect(context.taskContextStr).toContain('first')
    expect(context.taskContextStr).toContain('second')
    expect(context.kris[0]).toContain('Review changes')
    expect(context.kpis[0].name).toBe('quality')
  })
})
