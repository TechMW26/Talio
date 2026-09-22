jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
const { GET } = require('@/app/api/hierarchy/tree/route')
const { getAuthAndModels } = require('@/lib/auth')
function query(value) {
  const q = { lean: async () => value }
  for (const method of ['populate', 'select']) q[method] = () => q
  return q
}
async function tree(employees) {
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'user', employeeId: 'employee' }, models: {
    Employee: { find: () => query(employees) }, User: { find: () => query([]) },
  } })
  const response = await GET(new Request('https://talio.test/api/hierarchy/tree'))
  expect(response.status).toBe(200)
  return (await response.json()).data
}
describe('organogram uses saved reporting relationships', () => {
  test('shows an employee below their actual manager, not the executive', async () => {
    const data = await tree([
      { _id: 'employee', firstName: 'Employee', designationLevel: 2, reportingManager: 'manager', reportsTo: 'director' },
      { _id: 'manager', firstName: 'Manager', designationLevel: 6, reportingManager: 'director' },
      { _id: 'director', firstName: 'Director', designationLevel: 9 },
    ])
    expect(data.roots[0].children[0].id).toBe('manager')
    expect(data.roots[0].children[0].children[0]).toMatchObject({ id: 'employee', isViewer: true })
    expect(data.totalEmployees).toBe(3)
  })
  test('missing managers do not cause employees to disappear or get assigned arbitrarily', async () => {
    const data = await tree([
      { _id: 'employee', reportingManager: 'departed', department: { _id: 'dept' } },
      { _id: 'head', designationLevel: 6, department: { _id: 'dept' } },
    ])
    expect(data.roots.map(node => node.id).sort()).toEqual(['employee', 'head'])
  })
  test('cycles and self-reporting are serialized without losing employees', async () => {
    const data = await tree([{ _id: 'a', reportingManager: 'b' }, { _id: 'b', reportingManager: 'a' }, { _id: 'c', reportingManager: 'c' }])
    const ids = []
    const visit = node => { ids.push(node.id); node.children.forEach(visit) }
    data.roots.forEach(visit)
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })
})
