jest.mock('@/lib/teamViews.server', () => ({ teamViewAuth: jest.fn(), TEAM_VIEW_OPTIONS: { queryFields: { employees: [] } } }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/organization.server', () => ({ organizationEmployee: async (db, id) => id ? db.get('employees', id) : null }))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: async () => ({ features: { gpsAttendance: false } }) }))
jest.mock('@/lib/communicationsStore.server', () => ({ announcementApplies: () => true, policyApplies: () => true }))
jest.mock('@/lib/leaveData', () => ({ normalizeLeaveBalances: rows => rows }))
jest.mock('@/lib/projects.server', () => ({
  projectId: value => String(value?._id || value || ''),
  projectFilter: (field, value, operator = '==') => ({ field, value, operator }),
  projectRows: async (db, collection, filters) => (await db.list(collection, { filters })).records,
  projectRecords: async (db, collection, ids) => [...(await jest.requireActual('@/lib/platform/firestoreQueries.server').readFirestoreReferences(db, collection, ids)).values()],
  employeeSummary: row => row ? { _id: row._id, firstName: row.firstName } : null,
}))
import { unifiedDashboard } from '@/lib/dashboardData.server'
import { teamViewAuth } from '@/lib/teamViews.server'

test('dashboard batches announcement authors, departments and leave types', async () => {
  const db = {
    databaseName: 'talio_company_a',
    get: jest.fn(async () => ({ _id: 'employee-a' })),
    getMany: jest.fn(async (collection, ids) => ids.map(_id => ({ _id, firstName: collection }))),
    list: jest.fn(async collection => ({ records: collection === 'announcements'
      ? Array.from({ length: 5 }, (_, i) => ({ _id: `a${i}`, status: 'published', createdBy: 'author', departments: ['d1', 'd1', 'd2'], createdAt: new Date(2026, 0, i + 1) }))
      : [{ _id: 'b1', leaveType: 'annual' }, { _id: 'b2', leaveType: 'annual' }] })),
  }
  teamViewAuth.mockResolvedValue({ database: db, user: { _id: 'user-a', employeeId: 'employee-a', role: 'employee' }, tenant: { companySlug: 'tenant-a' } })
  const result = await (await unifiedDashboard(new Request('https://app.test/api/dashboard?widgets=announcements,leaveBalance'))).json()
  expect(result.announcements).toHaveLength(5)
  expect(result.announcements[0].departments.map(row => row._id)).toEqual(['d1', 'd2'])
  expect(result.announcements[0].createdBy._id).toBe('author')
  expect(result.leaveBalance.map(row => row.leaveType._id)).toEqual(['annual', 'annual'])
  expect(db.getMany).toHaveBeenCalledTimes(3)
  expect(db.getMany).toHaveBeenCalledWith('employees', ['author'])
  expect(db.getMany).toHaveBeenCalledWith('departments', ['d1', 'd2'])
  expect(db.getMany).toHaveBeenCalledWith('leavetypes', ['annual'])
  expect(db.get).toHaveBeenCalledTimes(1)
})

test('helpdesk preview queries only top five per owned branch and merges duplicates', async () => {
  const row = n => ({ _id: String(n), createdAt: new Date(2026, 0, n), title: `Ticket ${n}` })
  const db = {
    databaseName: 'talio_company_a', get: jest.fn(async () => ({ _id: 'employee-a' })), getMany: jest.fn(async () => []),
    list: jest.fn(async (_, options) => ({ records: (options.filters[0].field === 'createdBy' ? [10, 8, 6, 4, 2] : [10, 9, 7, 5, 3]).map(row), nextCursor: 'older' })),
  }
  teamViewAuth.mockResolvedValue({ database: db, user: { _id: 'u', employeeId: 'employee-a', role: 'employee' }, tenant: { companySlug: 'a' } })
  const result = await (await unifiedDashboard(new Request('https://app.test/api/dashboard?widgets=helpdesk'))).json()
  expect(result.myHelpdesk.map(row => row._id)).toEqual(['10', '9', '8', '7', '6'])
  expect(db.list).toHaveBeenCalledTimes(2)
  for (const [collection, options] of db.list.mock.calls) {
    expect(collection).toBe('helpdesks')
    expect(options.limit).toBe(5)
    expect(options.orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }])
    expect(options.filters[0].value).toBe('employee-a')
  }
})

test.each(['admin', 'hr'])('%s leave preview uses a bounded pending query', async role => {
  const db = {
    databaseName: 'talio_company_a', get: jest.fn(async () => null), getMany: jest.fn(async () => []),
    list: jest.fn(async () => ({ records: [{ _id: 'leave', status: 'pending', createdAt: new Date() }], nextCursor: 'older' })),
  }
  teamViewAuth.mockResolvedValue({ database: db, user: { _id: 'u', role }, tenant: { companySlug: 'a' } })
  const result = await (await unifiedDashboard(new Request('https://app.test/api/dashboard?widgets=leaveRequests'))).json()
  expect(result.pendingLeaveRequests).toHaveLength(1)
  expect(db.list).toHaveBeenCalledTimes(1)
  expect(db.list).toHaveBeenCalledWith('leaves', {
    filters: [{ field: 'status', operator: '==', value: 'pending' }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 10,
  })
})

test('bounded preview queries have committed composite indexes', () => {
  const { indexes } = require('../../firestore.indexes.json')
  for (const field of ['createdBy', 'assignedTo', 'status']) expect(indexes).toContainEqual(expect.objectContaining({
    collectionGroup: 'records', queryScope: 'COLLECTION', fields: [
      { fieldPath: `data.${field}`, order: 'ASCENDING' },
      { fieldPath: 'data.createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  }))
})
