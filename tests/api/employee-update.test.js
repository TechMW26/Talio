jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data, init = {}) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      return new MockNextResponse(JSON.stringify(data), {
        ...init,
        headers,
        status: init.status || 200,
      })
    }
  }

  return { NextResponse: MockNextResponse }
})

jest.mock('@/lib/auth', () => ({
  getAuthAndModels: jest.fn(),
}))

jest.mock('@/lib/queryCache', () => ({
  __esModule: true,
  default: {
    generateKey: jest.fn(() => 'employee-key'),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clearPattern: jest.fn(),
  },
}))

jest.mock('@/lib/cache', () => ({
  buildCacheKey: jest.fn(() => 'cache-key'),
  buildCachePattern: jest.fn(() => 'cache-pattern'),
  getCache: jest.fn(),
  setCache: jest.fn().mockResolvedValue(undefined),
  clearCachePattern: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/activityLogger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/backupDb', () => ({
  deleteUserFromBackup: jest.fn(),
}))

jest.mock('@/lib/realtimeEvents', () => ({
  emitEmployeeUpdate: jest.fn(),
  emitDashboardRefresh: jest.fn(),
  emitAssetUpdate: jest.fn(),
}))

const { getAuthAndModels } = require('@/lib/auth')
const { PUT: updateEmployee } = require('@/app/api/employees/[id]/route')

const EMPLOYEE_ID = '6957b35cbf0b9ea49ca507a1'

function createPopulateQuery(result) {
  const query = {
    populate: jest.fn(() => query),
    lean: jest.fn().mockResolvedValue(result),
  }
  return query
}

function createModels() {
  const existingEmployee = {
    _id: EMPLOYEE_ID,
    employeeCode: 'EMP-001',
    email: 'employee@talio.in',
    designationLevel: 9,
  }
  const updatedEmployee = {
    ...existingEmployee,
    reportsTo: null,
    reportingManager: null,
  }
  const updateQuery = createPopulateQuery(updatedEmployee)

  return {
    existingEmployee,
    updatedEmployee,
    models: {
      Employee: {
        findById: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue(existingEmployee),
        })),
        findOne: jest.fn(),
        findByIdAndUpdate: jest.fn(() => updateQuery),
      },
      User: {},
      Department: {},
      Designation: null,
      Role: null,
    },
  }
}

describe('employee update references', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('accepts empty optional relationships and persists them as null', async () => {
    const { models } = createModels()
    getAuthAndModels.mockResolvedValue({
      success: true,
      user: { _id: 'admin-1', role: 'admin' },
      tenant: { databaseName: 'talio_company_test' },
      models,
    })

    const request = new Request(`http://localhost:3000/api/employees/${EMPLOYEE_ID}`, {
      method: 'PUT',
      body: JSON.stringify({
        reportsTo: '',
        reportingManager: '',
        assignedManager: '',
        assignedTeamLead: '',
        designation: '',
        department: '',
        company: '',
        departments: [],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await updateEmployee(request, {
      params: Promise.resolve({ id: EMPLOYEE_ID }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(models.Employee.findByIdAndUpdate).toHaveBeenCalledWith(
      EMPLOYEE_ID,
      expect.objectContaining({
        reportsTo: null,
        reportingManager: null,
        assignedManager: null,
        assignedTeamLead: null,
        designation: null,
        department: null,
        company: null,
        departments: [],
      }),
      { new: true, runValidators: true }
    )
    expect(body).toMatchObject({ success: true, message: 'Employee updated successfully' })
  })

  test('rejects a malformed relationship with a precise field error', async () => {
    const { models } = createModels()
    getAuthAndModels.mockResolvedValue({
      success: true,
      user: { _id: 'admin-1', role: 'admin' },
      tenant: { databaseName: 'talio_company_test' },
      models,
    })

    const request = new Request(`http://localhost:3000/api/employees/${EMPLOYEE_ID}`, {
      method: 'PUT',
      body: JSON.stringify({ assignedManager: 'not-an-object-id' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await updateEmployee(request, {
      params: Promise.resolve({ id: EMPLOYEE_ID }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ success: false, message: 'Invalid assigned manager' })
    expect(models.Employee.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})
