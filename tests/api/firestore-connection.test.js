jest.mock('firebase-admin/app', () => ({ cert: jest.fn(value => value), getApps: jest.fn(() => []), initializeApp: jest.fn((options, name) => ({ options, name })) }))
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn(() => 'firestore-client') }))

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getTalioFirestore } from '../../lib/platform/firestore.server'

describe('retired Firestore data connection does not affect Firebase notifications', () => {
  beforeEach(() => { jest.clearAllMocks(); getApps.mockReturnValue([]) })
  test('fails closed regardless of source configuration', () => {
    for (const env of [{}, { FIRESTORE_PROJECT_ID: 'talio-hrms' }, { FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' }]) expect(() => getTalioFirestore(env)).toThrow('retired')
    expect(initializeApp).not.toHaveBeenCalled()
  })
  test('does not reuse the notification Firebase app', () => {
    getApps.mockReturnValue([{ name: '[DEFAULT]', options: { projectId: 'notifications-project' } }])
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' })).toThrow('retired')
    expect(initializeApp).not.toHaveBeenCalled()
    expect(getApps).not.toHaveBeenCalled()
    expect(getFirestore).not.toHaveBeenCalled()
  })
  test('never reconnects or reuses a source data application', () => {
    const app = { name: 'talio-firestore-data', options: { projectId: 'talio-hrms' } }
    getApps.mockReturnValue([app])
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms' })).toThrow('retired')
    expect(cert).not.toHaveBeenCalled()
    expect(getFirestore).not.toHaveBeenCalled()
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'another-project' })).toThrow('retired')
  })
})
