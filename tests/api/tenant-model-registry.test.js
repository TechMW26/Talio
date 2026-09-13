import mongoose from 'mongoose'
import { resolveModelDependencies } from '@/lib/platform/modelDependencies'

const mockConnections = new Map()
const mockGetConnection = jest.fn(async (name) => {
  if (!mockConnections.has(name)) {
    const connection = mongoose.createConnection()
    connection.name = name
    mockConnections.set(name, connection)
  }
  return mockConnections.get(name)
})
jest.mock('@/lib/tenantDb.js', () => ({ getTenantConnection: (...args) => mockGetConnection(...args) }))
import { getTenantModels, getTenantModel, clearModelCache } from '@/lib/tenantModels'

describe('deterministic tenant model registry', () => {
  beforeEach(() => { mockGetConnection.mockClear(); clearModelCache() })

  test('transitive dependencies and cycles are visited once', () => {
    const result = resolveModelDependencies(['A', 'Alias', 'A'], { A: {}, B: {}, C: {} },
      { Alias: 'A' }, { A: ['B'], B: ['C'], C: ['A'] })
    expect(result.names).toEqual(['A', 'B', 'C'])
    expect(result.aliases.get('Alias')).toBe('A')
  })

  test.each(['constructor', '__proto__', 'not-a-model', undefined])('rejects invalid model %p', async name => {
    await expect(getTenantModel('one', name)).rejects.toThrow('Unknown model')
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  test('cold and warm requests return identical dependencies using one connection lookup each', async () => {
    const cold = await getTenantModels('one', ['Chat', 'Ticket'])
    const warm = await getTenantModels('one', ['Chat', 'Ticket'])
    expect(Object.keys(warm)).toEqual(Object.keys(cold))
    expect(warm.Designation).toBeDefined() // Chat -> Employee -> Designation
    expect(warm.Team).toBeDefined() // Chat -> User -> Team
    expect(warm.Ticket).toBe(warm.Helpdesk)
    for (const name of Object.keys(cold)) expect(warm[name]).toBe(cold[name])
    expect(mockGetConnection).toHaveBeenCalledTimes(2)
  })

  test('concurrent calls compile once and never reuse another tenant model', async () => {
    const [a, b, other] = await Promise.all([
      getTenantModels('one', ['Employee']), getTenantModels('one', ['Employee']),
      getTenantModels('two', ['Employee']),
    ])
    expect(a.Employee).toBe(b.Employee)
    expect(a.Employee).not.toBe(other.Employee)
    expect(a.Employee.db.name).toBe('one')
    expect(other.Employee.db.name).toBe('two')
  })

  test('a recycled connection cannot serve an old model', async () => {
    const before = await getTenantModels('recycled', ['Employee'])
    mockConnections.delete('recycled')
    clearModelCache('recycled')
    const after = await getTenantModels('recycled', ['Employee'])
    expect(after.Employee).not.toBe(before.Employee)
  })
})
