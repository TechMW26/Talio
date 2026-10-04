import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { ASSET_OPTIONS, saveAsset, listAssets } from '@/lib/assetsStore.server'
import { SUPPORT_OPTIONS, mutateTicket, listTickets, saveHoliday, listHolidays } from '@/lib/supportStore.server'
import { COMMUNICATION_OPTIONS, saveCommunication, listCommunications, readAnnouncement, acknowledgePolicy } from '@/lib/communicationsStore.server'
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(45000)
suite('native assets and support boundaries', () => {
  let firestore, database
  const employee = '111111111111111111111111', other = '222222222222222222222222', department = '333333333333333333333333'
  const user = { _id: '444444444444444444444444', employeeId: employee, role: 'employee', isActive: true }
  const outsider = { _id: '555555555555555555555555', employeeId: other, role: 'employee', isActive: true }
  const admin = { _id: '666666666666666666666666', employeeId: other, role: 'admin', isActive: true }
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  afterAll(() => firestore?.terminate())
  beforeEach(async () => {
    const fields = {}; for (const options of [ASSET_OPTIONS, SUPPORT_OPTIONS, COMMUNICATION_OPTIONS]) for (const [key, values] of Object.entries(options.queryFields)) fields[key] = [...new Set([...(fields[key] || []), ...values])]
    database = createFirestoreDatabase({ firestore, dataset: `test-support-${Date.now()}-${randomBytes(4).toString('hex')}`, databaseName: 'talio_company_test', constraints: ASSET_OPTIONS.constraints, queryFields: fields })
    for (const actor of [user, outsider, admin]) await database.create('users', actor)
    for (const id of [employee, other]) await database.create('employees', { _id: id, firstName: 'Test', status: 'active', department: id === employee ? department : null })
    await database.create('departments', { _id: department, name: 'Test' })
  })
  test('concurrent normalized asset code creation preserves one inventory record', async () => {
    const input = { name: 'Laptop', assetCode: 'LT-1', category: 'laptop' }
    const results = await Promise.allSettled([saveAsset(database, admin, input, { permissionGranted: true }), saveAsset(database, admin, { ...input, assetCode: 'lt-1' }, { permissionGranted: true })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('assets')).toBe(1)
  })
  test('asset transitions preserve history, own-asset views omit history, references and permission are mandatory', async () => {
    await expect(saveAsset(database, user, { name: 'No' })).rejects.toMatchObject({ status: 403 })
    const { record } = await saveAsset(database, admin, { name: 'Laptop', assetCode: 'LT-2', category: 'laptop', assignedTo: employee, status: 'assigned' }, { permissionGranted: true })
    expect(record.history).toHaveLength(1)
    expect((await listAssets(database, user, new URLSearchParams(), false))[0].history).toBeUndefined()
    await expect(listAssets(database, outsider, new URLSearchParams({ employeeId: employee }), false)).rejects.toMatchObject({ status: 403 })
    const updated = await saveAsset(database, admin, { status: 'returned' }, { id: record._id, permissionGranted: true })
    expect(updated.record.assignedTo).toBeNull(); expect(updated.record.returnDate).toBeInstanceOf(Date); expect(updated.record.history).toHaveLength(2)
  })
  test('tickets keep private/internal contents scoped and concurrent comments intact', async () => {
    const ticket = await mutateTicket(database, user, { subject: 'Laptop', description: 'Repair', category: 'IT' })
    await expect(listTickets(database, outsider, new URLSearchParams(), ticket._id)).rejects.toMatchObject({ status: 403 })
    await expect(mutateTicket(database, user, { comment: 'spoof', commentedBy: other }, { id: ticket._id, operation: 'comment' })).rejects.toMatchObject({ status: 403 })
    await Promise.all([mutateTicket(database, user, { comment: 'public' }, { id: ticket._id, operation: 'comment' }), mutateTicket(database, admin, { comment: 'private', isInternal: true }, { id: ticket._id, operation: 'comment' })])
    expect((await database.get('helpdesks', ticket._id)).comments).toHaveLength(2)
    expect((await listTickets(database, user, new URLSearchParams(), ticket._id)).comments.map(row => row.content)).toEqual(['public'])
  })
  test('policy audience and acknowledgment are server-bound and idempotent', async () => {
    const row = await saveCommunication(database, admin, 'policies', { title: 'Policy', content: 'Details', applicableTo: 'specific', specificEmployees: [employee] })
    expect((await listCommunications(database, outsider, 'policies', new URLSearchParams())).data).toEqual([])
    await expect(acknowledgePolicy(database, user, row._id, { employeeId: other }, 'test')).rejects.toMatchObject({ status: 403 })
    await expect(acknowledgePolicy(database, outsider, row._id, {}, 'test')).rejects.toMatchObject({ status: 403 })
    await Promise.all([acknowledgePolicy(database, user, row._id, {}, 'test'), acknowledgePolicy(database, user, row._id, {}, 'test')])
    expect((await database.get('policies', row._id)).acknowledgments).toHaveLength(1)
  })
  test('specific announcement cannot leak and duplicate views increment once', async () => {
    const row = await saveCommunication(database, admin, 'announcements', { title: 'Notice', content: 'Details', targetAudience: 'specific', specificEmployees: [employee], status: 'published', publishDate: '2026-10-01' })
    await expect(readAnnouncement(database, outsider, row._id)).rejects.toMatchObject({ status: 403 })
    expect((await listCommunications(database, outsider, 'announcements', new URLSearchParams())).data).toEqual([])
    await Promise.all([readAnnouncement(database, user, row._id), readAnnouncement(database, user, row._id)])
    expect((await database.get('announcements', row._id)).engagement.totalViews).toBe(1)
  })
  test('holiday scope and multi-day data survive native CRUD; employees cannot change holidays', async () => {
    const input = { name: 'Holiday', date: '2026-10-02', endDate: '2026-10-03', applicableTo: 'specific-locations', locations: ['Bhopal'], applicableFor: { allEmployees: false, departments: [department] } }
    await expect(saveHoliday(database, user, input)).rejects.toMatchObject({ status: 403 })
    const row = await saveHoliday(database, admin, input)
    expect(row.applicableFor.departments).toEqual([department]); expect(row.endDate).toBeInstanceOf(Date)
    expect((await listHolidays(database, new URLSearchParams('year=2026'))).map(item => item._id)).toEqual([row._id])
  })
})
