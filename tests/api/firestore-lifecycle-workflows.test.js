import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { createWorkflow, transitionWorkflow } from '@/lib/hrms/workflowService.server'
import { persistLifecycleReview } from '@/lib/hrms/lifecycleStore.server'
import { updateOffboardingAssetClearance } from '@/lib/hrms/offboardingAssets.server'
import { listVisibleWorkflows, WORKFLOW_QUERY_FIELDS } from '@/lib/hrms/workflowStore.server'

jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native workflow and lifecycle transactions', () => {
  let firestore, database
  const actor = { _id: '111111111111111111111111', role: 'hr' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => { await firestore?.terminate() })
  beforeEach(() => {
    database = createFirestoreDatabase({ firestore, dataset: `test-lifecycle-${Date.now()}-${randomBytes(5).toString('hex')}`, databaseName: 'talio_company_test', queryFields: { hrmsworkflows: WORKFLOW_QUERY_FIELDS, documents: ['employee', 'fileId'], assets: ['assignedTo'] }, constraints: { hrmsworkflows: [{ fields: ['idempotencyKey'], sparse: true }, { fields: ['caseNumber'] }] } })
  })
  test('workflow create retry commits one case and one audit event', async () => {
    const args = { database, actor, allowIncompleteData: true, payload: { module: 'helpdesk', title: 'Printer repair', idempotencyKey: 'printer' } }
    const result = await Promise.all([createWorkflow(args), createWorkflow(args)])
    expect(result.map(item => Boolean(item.deduplicated)).sort()).toEqual([false, true])
    expect(await database.count('hrmsworkflows')).toBe(1)
    expect(await database.count('hrmsworkflowevents')).toBe(1)
    expect((await listVisibleWorkflows(database, actor, { modules: ['helpdesk'], search: 'INTER' })).length).toBe(1)
    expect((await listVisibleWorkflows(database, { _id: 'other', role: 'employee' }, { modules: ['helpdesk'], search: 'printer' })).length).toBe(0)
  })
  test('competing transitions update version once and create one immutable event', async () => {
    const { workflow } = await createWorkflow({ database, actor, allowIncompleteData: true, payload: { module: 'helpdesk', title: 'Computer issue' } })
    const result = await Promise.all([transitionWorkflow({ database, actor, workflow, action: 'submit' }), transitionWorkflow({ database, actor, workflow, action: 'submit' })])
    expect(result.filter(item => item.success)).toHaveLength(1)
    expect(result.find(item => !item.success).code).toBe('VERSION_CONFLICT')
    expect(await database.count('hrmsworkflowevents')).toBe(2)
  })
  test('audit failure rolls back workflow transition', async () => {
    const { workflow } = await createWorkflow({ database, actor, allowIncompleteData: true, payload: { module: 'helpdesk', title: 'Computer issue' } })
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, create: (name, record) => name === 'hrmsworkflowevents' ? Promise.reject(new Error('Audit unavailable')) : tx.create(name, record) })) }
    await expect(transitionWorkflow({ database: failing, actor, workflow, action: 'submit' })).rejects.toThrow('Audit unavailable')
    expect((await database.get('hrmsworkflows', workflow._id)).status).toBe('draft')
  })
  test('evidence review commits all documents and lifecycle with optimistic conflict protection', async () => {
    let employee = { _id: '222222222222222222222222', address: 'Legacy string address', __v: 0, lifecycle: { onboarding: { checklist: [] } } }
    await database.create('employees', employee)
    employee = await database.get('employees', employee._id)
    const result = { lifecycle: { onboarding: { checklist: [{ key: 'documents', completed: true, verification: { documents: [{ fileId: 'private/path', fileName: 'Evidence.pdf', fileType: 'application/pdf', fileUrl: '/api/files/private/path', fileSize: 100, requirementKey: 'aadhaar' }] } }] } }, employeeUpdates: {} }
    const args = { employee, actor, result, action: 'complete_onboarding_item', body: { itemKey: 'documents' } }
    expect(await persistLifecycleReview(database, args)).toMatchObject({ __v: 1, address: 'Legacy string address' })
    expect((await database.list('documents')).records[0]).toMatchObject({ status: 'approved', employee: employee._id })
    expect(await persistLifecycleReview(database, args)).toBeNull()
  })
  test('evidence write failure leaves employee unmodified', async () => {
    let employee = { _id: '222222222222222222222222', __v: 0, lifecycle: {} }
    await database.create('employees', employee)
    employee = await database.get('employees', employee._id)
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, create: (name, record) => name === 'documents' ? Promise.reject(new Error('Evidence unavailable')) : tx.create(name, record) })) }
    await expect(persistLifecycleReview(failing, { employee, actor, result: { lifecycle: { onboarding: { checklist: [{ key: 'documents', verification: { documents: [{ fileId: 'file', fileName: 'test', requirementKey: 'aadhaar' }] } }] } } }, action: 'complete_onboarding_item', body: { itemKey: 'documents' } })).rejects.toThrow('Evidence unavailable')
    expect(await database.get('employees', employee._id)).toEqual(employee)
  })
  test('asset return and exit checklist commit atomically with one history event', async () => {
    const employeeId = '222222222222222222222222', assetId = '333333333333333333333333'
    await database.create('employees', { _id: employeeId, firstName: 'Test', lifecycle: { offboarding: { status: 'in_progress', assetChecklist: [] } } })
    await database.create('assets', { _id: assetId, name: 'Laptop', status: 'assigned', assignedTo: employeeId })
    const results = await Promise.all([updateOffboardingAssetClearance(database, employeeId, actor, { action: 'return', assetId }), updateOffboardingAssetClearance(database, employeeId, actor, { action: 'return', assetId })])
    expect(results.every(result => result.clearance.summary.complete)).toBe(true)
    const asset = await database.get('assets', assetId)
    expect(asset.status).toBe('available')
    expect(asset.history).toHaveLength(1)
    expect((await database.get('employees', employeeId)).lifecycle.offboarding.assetsReturned).toBe(true)
  })
  test('asset return write failure leaves assignment and clearance unchanged', async () => {
    const employeeId = '222222222222222222222222', assetId = '333333333333333333333333'
    await database.create('employees', { _id: employeeId, lifecycle: { offboarding: { status: 'in_progress', assetChecklist: [] } } })
    await database.create('assets', { _id: assetId, name: 'Laptop', status: 'assigned', assignedTo: employeeId })
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, replace: (name, record) => name === 'assets' ? Promise.reject(new Error('Asset unavailable')) : tx.replace(name, record) })) }
    await expect(updateOffboardingAssetClearance(failing, employeeId, actor, { action: 'return', assetId })).rejects.toThrow('Asset unavailable')
    expect((await database.get('employees', employeeId)).lifecycle.offboarding.assetChecklist).toEqual([])
    expect((await database.get('assets', assetId)).assignedTo).toBe(employeeId)
  })
})
