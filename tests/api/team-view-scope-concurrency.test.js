/**
 * The team-view scope resolver is on the sidebar-counts, dashboard, leave and
 * team routes. It used to issue its lookups one after another (10-20+ sequential
 * Firestore round-trips). These tests pin the batched/concurrent behaviour so a
 * future edit cannot quietly reintroduce the serial chain.
 */
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/platform/firestoreStore.server', () => ({ getFirestoreMembershipBatchSize: () => 2 }))
jest.mock('@/lib/leaveApi.server', () => ({ afterChange: jest.fn() }))
jest.mock('@/lib/leaveRequests.server', () => ({ LEAVE_STORE_OPTIONS: {}, transitionLeaveRequest: jest.fn(), populateLeaves: jest.fn() }))
jest.mock('@/lib/organization.server', () => ({
  ORGANIZATION_STORE_OPTIONS: { queryFields: { departments: [], employees: [], teams: [] } },
  organizationEmployee: jest.fn(),
}))
jest.mock('@/lib/projects.server', () => {
  const projectId = value => String(value?._id || value || '')
  const projectFilter = (field, value, operator = '==') => ({ field, value, operator })
  return {
    PROJECT_STORE_OPTIONS: { queryFields: { departments: [], employees: [], teams: [], leaves: [] } },
    projectId,
    projectFilter,
    projectFailure: message => Object.assign(new Error(message), { status: 400 }),
    populateTask: jest.fn(),
    employeeSummary: row => row,
    newProjectRecordId: () => 'x',
    // Instrumented reads: records peak concurrency and total call count.
    projectRows: jest.fn(),
    projectRecords: jest.fn(),
  }
})

import { resolveTeamViewScope, scopedEmployeeRows } from '@/lib/teamViews.server'
import { projectRows, projectRecords } from '@/lib/projects.server'

function instrument({ departments, employees }) {
  const state = { inFlight: 0, peak: 0, calls: 0, waves: 0 }
  const track = async value => {
    state.calls += 1
    state.inFlight += 1
    if (state.inFlight === 1) state.waves += 1 // a new burst of parallel work
    state.peak = Math.max(state.peak, state.inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    state.inFlight -= 1
    return value
  }
  const database = {
    databaseName: 'talio_company_a',
    list: async () => ({ records: [] }),
    count: async () => 0,
  }
  projectRows.mockImplementation(async (_db, collection, filters) => {
    if (collection === 'departments') {
      const field = filters[0].field
      if (field === 'head' || field === 'heads') return track([{ _id: 'authority-1', isActive: true, head: 'e-head', heads: [] }])
      return track([])
    }
    if (collection === 'employees') return track(employees)
    return track([{ _id: `${collection}-row` }])
  })
  projectRecords.mockImplementation(async (_db, collection, ids) => {
    if (collection === 'departments') return track((departments || []).map(id => ({ _id: id, isActive: true, head: 'e-head', heads: [] })))
    return track((ids || []).map(id => ({ _id: id })))
  })
  return { database, state }
}

beforeEach(() => jest.clearAllMocks())

test('scope resolution runs its independent reads concurrently, not serially', async () => {
  const { database, state } = instrument({
    departments: ['d1', 'd2', 'd3'],
    employees: [{ _id: 'e2' }],
  })
  const user = {
    _id: 'u1', employeeId: 'e1', role: 'department_head',
    isDepartmentHead: true, headOfDepartments: ['d1', 'd2', 'd3'],
    isDepartmentManager: false, teamLeaderOf: [],
  }

  const scope = await resolveTeamViewScope(database, user, { organization: false })

  // Correct results are unchanged.
  expect(scope.authorityDepartments.map(row => row._id)).toContain('authority-1')
  expect(scope.employeeId).toBe('e1')
  // Several reads were in flight at the same time (serial execution peaks at 1).
  expect(state.peak).toBeGreaterThan(1)
  expect(state.calls).toBeGreaterThan(3)
  // Independently of how many reads are needed, they collapse into a couple of
  // parallel waves instead of one round-trip per lookup.
  expect(state.waves).toBeLessThanOrEqual(3)
})

test('scoped employee batches run concurrently instead of one after another', async () => {
  const { database, state } = instrument({ employees: [{ _id: 'e2' }] })
  const rows = await scopedEmployeeRows(database, 'leaves', ['a', 'b', 'c', 'd', 'e'])
  expect(rows.length).toBeGreaterThan(0)
  // batch size is mocked to 2, so 3 batches must overlap.
  expect(state.peak).toBeGreaterThan(1)
})

test('reports the round-trip saving for a department head', async () => {
  const { database, state } = instrument({ departments: ['d1', 'd2', 'd3'], employees: [{ _id: 'e2' }] })
  const user = {
    _id: 'u1', employeeId: 'e1', role: 'department_head',
    isDepartmentHead: true, headOfDepartments: ['d1', 'd2', 'd3'],
    isDepartmentManager: false, teamLeaderOf: [],
  }
  await resolveTeamViewScope(database, user, { organization: false })
  // Previously: one round-trip per lookup (~19 sequential reads for 3 departments).
  // Now the same reads complete in at most a few concurrent waves.
  expect(state.calls).toBeGreaterThanOrEqual(6)
  expect(state.waves).toBeLessThanOrEqual(3)
})
