jest.mock('firebase-admin/app', () => ({ cert: jest.fn(), getApps: jest.fn(), initializeApp: jest.fn() }))
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }))
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getTalioFirestore } from '@/lib/platform/firestore.server'

describe('native server data client lifecycle', () => {
  let apps, env
  beforeEach(() => {
    jest.resetAllMocks()
    apps = [{ name: '[DEFAULT]', options: { projectId: 'notification-project' } }]
    env = { FIRESTORE_PROJECT_ID: 'talio-data-project', FIRESTORE_SERVICE_ACCOUNT_JSON: '{"project_id":"talio-data-project"}' }
    getApps.mockImplementation(() => apps)
    cert.mockReturnValue({ credential: true })
    initializeApp.mockImplementation((options, name) => {
      const app = { name, options }
      apps.push(app)
      return app
    })
    getFirestore.mockImplementation((app, database) => ({ app, database }))
  })

  test('100 concurrent callers initialize one dedicated data app, never the notification app', async () => {
    const clients = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => getTalioFirestore(env))))
    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(clients.every(client => client.app === apps[1])).toBe(true)
    expect(clients[0]).toMatchObject({ app: { name: 'talio-firestore-data' }, database: '(default)' })
  })

  test('project configuration is explicit and cannot change after initialization', () => {
    expect(() => getTalioFirestore({})).toThrow('FIRESTORE_PROJECT_ID')
    expect(() => getTalioFirestore({ ...env, FIRESTORE_SERVICE_ACCOUNT_JSON: '' })).toThrow('FIRESTORE_SERVICE_ACCOUNT_JSON')
    getTalioFirestore(env)
    expect(() => getTalioFirestore({ ...env, FIRESTORE_PROJECT_ID: 'different-project' })).toThrow('project changed')
  })

  test('invalid credentials fail closed and a corrected initialization can retry', () => {
    expect(() => getTalioFirestore({ ...env, FIRESTORE_SERVICE_ACCOUNT_JSON: 'invalid' })).toThrow('Invalid Firestore')
    expect(initializeApp).not.toHaveBeenCalled()
    expect(getTalioFirestore(env).app.name).toBe('talio-firestore-data')
  })

  test('failed initialization does not poison later requests', () => {
    initializeApp.mockImplementationOnce(() => { throw new Error('initialization failed') })
    expect(() => getTalioFirestore(env)).toThrow('initialization failed')
    expect(getTalioFirestore(env).app.name).toBe('talio-firestore-data')
    expect(initializeApp).toHaveBeenCalledTimes(2)
  })

  test('named native databases are passed explicitly without switching project', () => {
    expect(getTalioFirestore({ ...env, FIRESTORE_DATABASE_ID: 'acceptance' }).database).toBe('acceptance')
    expect(initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'talio-data-project' }), 'talio-firestore-data')
  })
})
