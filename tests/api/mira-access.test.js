import { getMiraAccess, updateMiraSettings, isMiraExecutionPath } from '@/lib/miraAccess.server'

const makeDatabase = (settings, user = { isActive: true, role: 'admin' }, level = 6) => {
  const get = jest.fn(async (collection) => ({ servicesettings: settings, users: user, employees: { designation: 'designation' }, designations: { level } })[collection])
  const tx = { get, replace: jest.fn(), create: jest.fn() }
  return { ...tx, transaction: callback => callback(tx) }
}
test('preserves legacy behavior until levels are configured and enforces master-off', async () => {
  expect((await getMiraAccess(makeDatabase(null), {})).allowed).toBe(true)
  expect((await getMiraAccess(makeDatabase({ enabled: false }), { role: 'admin' })).allowed).toBe(false)
})
test('uses the actual designation, not admin role or client level claims', async () => {
  const db = makeDatabase({ enabled: true, allowedLevels: [9] })
  expect(await getMiraAccess(db, { role: 'admin', level: 9, employeeId: 'employee' })).toEqual({ allowed: false, level: 6 })
  expect((await getMiraAccess(makeDatabase({ enabled: true, allowedLevels: [6] }), { employeeId: 'employee' })).allowed).toBe(true)
  expect((await getMiraAccess(db, { role: 'admin' })).allowed).toBe(false)
})
test('honors a trusted employee L9 override independently of the Manager title default', async () => {
  const database = makeDatabase({ enabled: true, allowedLevels: [9] })
  const fallback = database.get
  database.get = jest.fn((collection, id) => collection === 'employees'
    ? Promise.resolve({ designation: 'designation', designationLevel: 9 }) : fallback(collection, id))
  expect(await getMiraAccess(database, { employeeId: 'employee', role: 'admin' })).toEqual({ allowed: true, level: 9 })
})
test('requires fresh administrator authority inside the settings transaction', async () => {
  const changes = { enabled: true, allowedLevels: [6] }
  await expect(updateMiraSettings(makeDatabase(null), { _id: 'user', role: 'employee' }, changes)).rejects.toMatchObject({ status: 403 })
  await expect(updateMiraSettings(makeDatabase(null, { isActive: true, role: 'employee' }), { _id: 'user', role: 'admin' }, changes)).rejects.toMatchObject({ status: 403 })
  for (const levels of [[0], [10], ['6'], [6, 6]]) await expect(updateMiraSettings(makeDatabase(null), { role: 'admin' }, { enabled: true, allowedLevels: levels })).rejects.toMatchObject({ status: 400 })
})
test('preserves provider metadata and other settings while saving access', async () => {
  const db = makeDatabase({ agent: { agentId: 'owned' }, enabled: true })
  await updateMiraSettings(db, { role: 'admin', _id: 'admin' }, { enabled: false, allowedLevels: [] })
  expect(db.replace).toHaveBeenCalledWith('servicesettings', expect.objectContaining({ _id: 'mira', agent: { agentId: 'owned' }, enabled: false, allowedLevels: [] }))
})
test('all execution routes are gated while administrators can recover configuration', () => {
  for (const path of ['/api/ai/mira-chat', '/api/ai/mira-actions', '/api/ai/mira-agent/session', '/api/ai/mira-images/image', '/api/mira/sessions']) expect(isMiraExecutionPath(path)).toBe(true)
  for (const path of ['/api/mira/access', '/api/mira/agent', '/api/mira/preferences', '/api/employees']) expect(isMiraExecutionPath(path)).toBe(false)
})
