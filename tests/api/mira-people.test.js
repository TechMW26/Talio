import { resolveMiraPerson, romanizeMiraName } from '@/lib/miraPeople'
import { getProductivityViewStore } from '@/lib/platform/firestoreProductivityView.server'
jest.mock('@/lib/platform/firestoreProductivityView.server', () => ({ getProductivityViewStore: jest.fn(), populateProductivityEmployees: async (_, records) => records, getProductivityVisibility: jest.fn() }))
const user = { employeeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'employee' }, context = { databaseName: 'tenant' }
const person = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', status: 'active', firstName: 'Sahil', lastName: 'Sahu', employeeCode: 'U22', department: { name: 'Tech' }, reportingManager: user.employeeId }
let store, rows
beforeEach(() => {
  rows = [person]
  store = { get: jest.fn(async (_, id) => rows.find(row => row._id === id)), list: jest.fn(async (_, options) => ({ records: rows.filter(row => options.filters.every(filter => filter.field === 'status' ? row.status === filter.value : row[filter.field] === filter.value)), nextCursor: null })) }
  getProductivityViewStore.mockResolvedValue(store)
})
test('exact names resolve only from explicitly scoped reporting queries', async () => {
  expect(await resolveMiraPerson('Sahil', user, context, { type: 'create_task' })).toBe(person._id)
  expect(store.list).toHaveBeenCalledWith('employees', expect.objectContaining({ filters: expect.arrayContaining([{ field: 'reportingManager', operator: '==', value: user.employeeId }]) }))
})
test('Hindi phonetic matches remain suggestions', async () => {
  expect(romanizeMiraName('साहिल साहू')).toBe('saahil saahoo')
  await expect(resolveMiraPerson('साहिल', user, context, { type: 'send_message', field: 'recipient' })).rejects.toMatchObject({ resolution: { field: 'recipient', candidates: [expect.objectContaining({ name: 'Sahil Sahu', department: 'Tech' })] } })
})
test('ambiguous names require a choice', async () => {
  rows.push({ ...person, _id: 'cccccccccccccccccccccccc', lastName: 'Sharma' })
  await expect(resolveMiraPerson('Sahil', user, context, { type: 'send_message' })).rejects.toMatchObject({ resolution: { candidates: expect.any(Array) } })
})
test.each(['Sahl', 'Zahil Sahu'])('unique one-edit typo %s resolves within reporting scope', async name => {
  expect(await resolveMiraPerson(name, user, context, { type: 'create_task' })).toBe(person._id)
})
test('ambiguous one-edit matches never auto-select', async () => {
  rows = [{ ...person, firstName: 'Pinky' }, { ...person, _id: 'cccccccccccccccccccccccc', firstName: 'Pinky', lastName: 'Patil' }]
  await expect(resolveMiraPerson('Pinki', user, context, { type: 'send_message' })).rejects.toMatchObject({ resolution: { candidates: expect.any(Array) } })
})
test('letter spelling and exact employee code resolve', async () => {
  expect(await resolveMiraPerson('S A H I L', user, context, { type: 'send_message' })).toBe(person._id)
  expect(await resolveMiraPerson('employee:U22', user, context, { type: 'create_task' })).toBe(person._id)
  await expect(resolveMiraPerson('employee:U220', user, context, { type: 'create_task' })).rejects.toThrow('No matching person')
})
test('selected IDs recheck scope and tenant rather than trusting supplied identity', async () => {
  rows = [{ ...person, reportingManager: 'unrelated' }]
  await expect(resolveMiraPerson('employee:' + person._id, user, context, { type: 'create_task' })).rejects.toThrow('No matching person')
  await expect(resolveMiraPerson('Sahil', user, {}, { type: 'send_message' })).rejects.toThrow('verified tenant')
})
test('unknown names ask for spelling', async () => {
  rows = []
  await expect(resolveMiraPerson('Unknown', user, context, { type: 'send_message' })).rejects.toThrow('spell the name')
})
