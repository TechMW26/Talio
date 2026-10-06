import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getProfileStore, getProfileRecords, populateProfileEmployee, replaceProfilePicture, replaceAadhaarImage, saveAadhaarVerification } from '@/lib/platform/firestoreProfile.server'
import { whiteboardPermission, assertWhiteboardAccess, listVisibleWhiteboards, mutateWhiteboard, saveWhiteboardAnalysis, validateWhiteboardShares } from '@/lib/whiteboards.server'
import { getPreferences, validatePreferences } from '@/lib/platform/firestorePreferences.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(), clearCachePattern: jest.fn() }))
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
emulator('Native profile, Aadhaar and whiteboards', () => {
  let firestore, store, context
  const databaseName = 'talio_company_profile_test'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(() => firestore.terminate())
  beforeEach(async () => {
    const dataset = 'test-profile-' + randomBytes(8).toString('hex')
    getFirestoreTenantDatabase.mockImplementation(async (name, options = {}) => {
      if (name !== databaseName) throw new Error('Wrong tenant')
      return createFirestoreDatabase({ firestore, dataset, databaseName, ...options, queryFields: {
        ...options.queryFields, whiteboards: ['owner', 'createdBy', 'sharedWith', 'sharedUserIds', 'updatedAt'],
      } })
    })
    store = await getProfileStore(databaseName)
    context = { store, userId: 'user', employeeId: 'employee', databaseName }
    await store.create('users', { _id: 'user', employeeId: 'employee', avatar: '/old', avatarFileId: 'old' })
    await store.create('employees', { _id: 'employee', userId: 'user', firstName: 'Test', salary: 123, profilePicture: '/old', profilePictureFileId: 'old' })
  })
  test('profile joins redact unrelated private fields and avatar updates are atomic', async () => {
    const { employee } = await getProfileRecords(store, 'user')
    expect((await populateProfileEmployee(store, employee)).salary).toBeUndefined()
    expect(await replaceProfilePicture(store, 'user', 'employee', { _id: 'new', url: '/new' })).toEqual(['old'])
    expect((await store.get('users', 'user')).avatar).toBe('/new')
    expect((await store.get('employees', 'employee')).profilePicture).toBe('/new')
    await store.create('employees', { _id: 'other', userId: 'other-user' })
    await expect(replaceProfilePicture(store, 'user', 'other', { _id: 'bad', url: '/bad' })).rejects.toThrow('link')
    expect((await store.get('users', 'user')).avatar).toBe('/new')
    await replaceProfilePicture(store, 'user', 'employee', null)
    expect((await store.get('users', 'user')).avatar).toBeUndefined()
    expect((await store.get('employees', 'employee')).profilePicture).toBeUndefined()
  })
  test('concurrent Aadhaar sides merge, replacement resets verification and stale OCR cannot succeed', async () => {
    await store.mutate('users', 'user', user => ({ ...user, profileCompletion: { completedFields: { personalInfo: true } } }))
    await Promise.all(['front', 'back'].map(side => replaceAadhaarImage(store, 'user', side, { _id: side, url: '/' + side })))
    const user = await store.get('users', 'user')
    expect(user.profileCompletion.completedFields).toMatchObject({ personalInfo: true, aadhaarUploaded: true, ocrVerified: false })
    await saveAadhaarVerification(store, user, { status: 'verified' }, { employeeId: 'employee', address: 'Verified address' })
    expect((await store.get('users', 'user')).profileCompletion.status).toBe('complete')
    expect((await store.get('employees', 'employee')).address.fullAddress).toBe('Verified address')
    await replaceAadhaarImage(store, 'user', 'front', { _id: 'replacement', url: '/replacement' })
    await expect(saveAadhaarVerification(store, user, { status: 'verified' })).rejects.toMatchObject({ status: 409 })
    expect((await store.get('users', 'user')).profileCompletion.ocrVerification.status).toBe('pending')
  })
  test('whiteboard legacy and modern grants are enforced without tenant-wide visibility', async () => {
    const boards = [
      { _id: 'own', owner: 'user' }, { _id: 'legacy', createdBy: 'employee' },
      { _id: 'shared-old', sharedWith: ['employee'] }, { _id: 'shared-new', sharing: [{ userId: 'user', permission: 'view_only' }] },
      { _id: 'secret', owner: 'other' }, { _id: 'public', isPublic: true },
    ]
    for (const board of boards) await store.create('whiteboards', { ...board, pages: [{ id: 'page-1', objects: [] }], updatedAt: new Date(0) })
    expect((await listVisibleWhiteboards(context)).map(board => board._id).sort()).toEqual(['legacy', 'own', 'shared-new', 'shared-old'])
    expect(() => assertWhiteboardAccess(boards[4], context)).toThrow('Access denied')
    expect(whiteboardPermission(boards[5], context)).toBe('view_only')
    await expect(mutateWhiteboard(context, 'shared-new', board => ({ ...board, title: 'hack' }))).rejects.toMatchObject({ status: 403 })
    await expect(mutateWhiteboard(context, 'shared-old', board => ({ ...board, isPublic: true }), { required: 'owner' })).rejects.toMatchObject({ status: 403 })
  })
  test('stale AI canvas saves cannot overwrite newer edits or revoked access', async () => {
    await store.create('whiteboards', { _id: 'board', owner: 'user', pages: [], updatedAt: new Date(0) })
    const original = await store.get('whiteboards', 'board')
    await mutateWhiteboard(context, 'board', board => ({ ...board, title: 'Collaborator edit' }))
    await expect(saveWhiteboardAnalysis(context, { ...original, aiAnalysis: { summary: 'stale' } })).rejects.toMatchObject({ status: 409 })
    expect((await store.get('whiteboards', 'board')).title).toBe('Collaborator edit')
    const latest = await store.get('whiteboards', 'board')
    await store.mutate('whiteboards', 'board', board => ({ ...board, owner: 'other' }))
    await expect(saveWhiteboardAnalysis(context, latest)).rejects.toMatchObject({ status: 403 })
    await expect(validateWhiteboardShares(context, ['outside-tenant'])).rejects.toMatchObject({ status: 404 })
  })
  test('preferences keep imported singleton IDs and reject invalid or protected values', async () => {
    expect((await getPreferences(store)).currency).toBe('INR')
    await store.create('systempreferences', { _id: 'imported-id', currency: 'USD' })
    expect((await getPreferences(store))._id).toBe('imported-id')
    expect(validatePreferences({ currency: 'EUR', _id: 'attack', companyLogoFileId: 'other' })).toEqual({ currency: 'EUR' })
    expect(() => validatePreferences({ workingDaysPerWeek: 8 })).toThrow()
    expect(() => validatePreferences({ timezone: 'Fake/Zone' })).toThrow()
    expect(() => validatePreferences({ emailNotifications: 'true' })).toThrow()
  })
})
