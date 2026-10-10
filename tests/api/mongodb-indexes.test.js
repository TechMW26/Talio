const { RECORD_INDEXES, PREFIX, installRecordIndexes, validateIndexes } = require('../../scripts/mongodb-migration/indexes.cjs')
const { explainHotQueries } = require('../../scripts/mongodb-migration/setup-indexes.cjs')

test('hot indexes remain scoped, partial and comfortably below the64index cap', () => {
  expect(validateIndexes()).toBe(RECORD_INDEXES)
  expect(RECORD_INDEXES.length + 1).toBeLessThan(40)
  for (const index of RECORD_INDEXES) {
    expect(Object.fromEntries(Object.entries(index.key).slice(0, 3))).toEqual(PREFIX)
    if (!index.unique) expect(index.partialFilterExpression).toBeDefined()
    expect(index.expireAfterSeconds).toBeUndefined()
  }
  expect(RECORD_INDEXES.find(index => index.name === 'talio_employee_date_v1').key).toMatchObject({ 'envelope.data.employee': 1, 'envelope.data.date': 1 })
  expect(RECORD_INDEXES.find(index => index.name === 'talio_user_day_v1').key).toMatchObject({ 'envelope.data.user': 1, 'envelope.data.dateString': 1 })
  expect(RECORD_INDEXES.find(index => index.name === 'talio_project_status_v1').key).toMatchObject({ 'envelope.data.project': 1, 'envelope.data.status': 1 })
  expect(RECORD_INDEXES.find(index => index.name === 'talio_project_order_v1').key).toMatchObject({ 'envelope.data.project': 1, 'envelope.data.order': -1 })
  expect(RECORD_INDEXES.find(index => index.name === 'talio_task_v1').partialFilterExpression).toEqual({ 'envelope.data.task': { $exists: true } })
})

test('index installation is idempotent and never removes an existing index', async () => {
  const installed = [{ name: '_id_', key: { _id: 1 } }]
  const createIndex = jest.fn(async (key, options) => { installed.push({ key, ...options }) })
  const db = { collection: () => ({ listIndexes: () => ({ toArray: async () => installed }), createIndex }) }
  expect(await installRecordIndexes(db)).toMatchObject({ createdIndexes: RECORD_INDEXES.length, droppedIndexes: 0 })
  createIndex.mockClear()
  expect(await installRecordIndexes(db)).toMatchObject({ createdIndexes: 0, droppedIndexes: 0 })
  expect(createIndex).not.toHaveBeenCalled()
})

test('existing index limits or conflicting definitions stop before any writes', async () => {
  const createIndex = jest.fn()
  const db = entries => ({ collection: () => ({ listIndexes: () => ({ toArray: async () => entries }), createIndex }) })
  await expect(installRecordIndexes(db(Array.from({ length: 63 }, (_, index) => ({ name: `custom_${index}`, key: { custom: 1 } }))))).rejects.toThrow('INDEX_LIMIT')
  await expect(installRecordIndexes(db([{ name: RECORD_INDEXES[0].name, key: { foreign: 1 }, unique: true }]))).rejects.toThrow('DEFINITION_CONFLICT')
  expect(createIndex).not.toHaveBeenCalled()
})

test('query measurement uses scoped real samples and only bounded execution explains', async () => {
  const findOne = jest.fn(async filter => {
    const data = {
      users: { email: 'sample@example.test' }, employees: { userId: 'user' }, usersessions: { tokenId: 'token' },
      attendances: { employee: 'employee', date: new Date('2026-10-10') },
      screenshots: { user: 'user', dateString: '2026-10-10', capturedAt: new Date('2026-10-10') },
      tasks: { project: 'project', status: 'custom-qa', order: 0 }, taskassignees: { task: 'task' },
    }
    return { envelope: { data: data[filter.collectionName] } }
  })
  const queries = []
  const find = jest.fn(filter => {
    const query = { filter }
    queries.push(query)
    return { sort: sort => { query.sort = sort; return { limit: limit => {
      query.limit = limit
      return { explain: async level => {
        query.level = level
        return { executionStats: { nReturned: 1, totalKeysExamined: 1, totalDocsExamined: 1, executionTimeMillis: 1 }, queryPlanner: { winningPlan: { inputStage: { stage: 'IXSCAN', indexName: 'scoped_index' } } } }
      } }
    } } } }
  })
  const db = { collection: () => ({ findOne, find }) }
  const report = await explainHotQueries(db, { dataset: 'test-query-report', databaseName: 'talio_company_sample' })
  expect(report).toMatchObject({ allMeasuredQueriesBounded: true, unmeasured: [] })
  expect(report.queries).toHaveLength(11)
  expect(report.queries.every(row => row.indexes.includes('scoped_index'))).toBe(true)
  for (const query of queries) {
    expect(query.filter.$and[0].dataset).toBe('test-query-report')
    expect(['talio_company_sample', 'talio_superadmin']).toContain(query.filter.$and[0].databaseName)
    expect(query.filter.$and.slice(1).every(condition => Object.values(condition)[0].$exists)).toBe(true)
    expect(query.level).toBe('executionStats')
    expect(query.limit).toBeLessThanOrEqual(101)
  }
  expect(findOne.mock.calls.every(([, options]) => options.projection._id === 0 && !options.projection.parts)).toBe(true)
  expect(report.queries.some(row => row.name === 'project-custom-kanban-status')).toBe(true)
})

test('missing data is explicitly unmeasured, never a fabricated index performance pass', async () => {
  const report = await explainHotQueries({ collection: () => ({ findOne: async () => null }) }, { dataset: 'test-query-report', databaseName: 'talio_company_sample' })
  expect(report).toMatchObject({ allMeasuredQueriesBounded: false, queries: [] })
  expect(report.unmeasured).toHaveLength(11)
})
