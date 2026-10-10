jest.mock('firebase-admin', () => ({
  __esModule: true,
  default: {
    apps: [], initializeApp: jest.fn(),
    credential: { cert: jest.fn(value => value) },
    messaging: jest.fn(),
  },
}))

const previousCredential = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
const previousLocalAcceptance = process.env.TALIO_LOCAL_ACCEPTANCE
let admin, delivery, app, messaging

beforeEach(() => {
  jest.resetModules()
  admin = require('firebase-admin').default
  app = { name: 'talio-fcm' }
  messaging = {
    send: jest.fn(async () => 'mock-message'),
    sendEachForMulticast: jest.fn(async () => ({ successCount: 1, failureCount: 0, responses: [{ success: true }] })),
    sendMulticast: jest.fn(async () => ({ successCount: 1, failureCount: 0, responses: [{ success: true }] })),
  }
  admin.initializeApp.mockReturnValue(app)
  // Passing no app reproduces the error from the SDK after the default
  // Firestore app is retired. No real provider is contacted by this suite.
  admin.messaging.mockImplementation(selected => {
    if (selected !== app) throw new Error('Wrong Firebase application')
    return messaging
  })
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'mock-fcm-project' })
  delete process.env.TALIO_LOCAL_ACCEPTANCE
  delivery = require('@/lib/firebaseNotification')
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  if (previousCredential === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  else process.env.FIREBASE_SERVICE_ACCOUNT_KEY = previousCredential
  if (previousLocalAcceptance === undefined) delete process.env.TALIO_LOCAL_ACCEPTANCE
  else process.env.TALIO_LOCAL_ACCEPTANCE = previousLocalAcceptance
})

test('single-device delivery uses the initialized named app without any default Firebase app', async () => {
  expect(admin.apps).toEqual([])
  expect(await delivery.sendNotificationToDevice('mock-token', { title: 'Test' })).toEqual({ success: true, messageId: 'mock-message' })
  expect(admin.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'mock-fcm-project' }), 'talio-fcm')
  expect(admin.messaging).toHaveBeenCalledWith(app)
  expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-token' }))
})

test('multicast delivery reuses talio-fcm and never selects an unrelated/default Firebase app', async () => {
  admin.apps.push({ name: '[DEFAULT]' }, { name: 'retired-source-app' }, app)
  expect(await delivery.sendNotificationToMultipleDevices(['mock-token'], { title: 'Test' })).toMatchObject({ success: true, successCount: 1 })
  expect(admin.initializeApp).not.toHaveBeenCalled()
  expect(admin.messaging).toHaveBeenCalledWith(app)
  expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1)
  expect(messaging.sendMulticast).not.toHaveBeenCalled()
})

test('legacy multicast fallback also binds delivery to talio-fcm', async () => {
  delete messaging.sendEachForMulticast
  expect(await delivery.sendNotificationToMultipleDevices(['mock-token'], {})).toMatchObject({ success: true, successCount: 1 })
  expect(admin.messaging).toHaveBeenCalledWith(app)
  expect(messaging.sendMulticast).toHaveBeenCalledTimes(1)
})

test('missing FCM credentials fail closed without looking up default messaging', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  expect(await delivery.sendNotificationToDevice('mock-token', {})).toEqual({ success: false, error: 'Firebase not initialized' })
  expect(admin.initializeApp).not.toHaveBeenCalled()
  expect(admin.messaging).not.toHaveBeenCalled()
})
