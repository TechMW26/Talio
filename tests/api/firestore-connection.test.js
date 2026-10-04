jest.mock('firebase-admin/app', () => ({ cert: jest.fn(value => value), getApps: jest.fn(() => []), initializeApp: jest.fn((options, name) => ({ options, name })) }))
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn(() => 'firestore-client') }))

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getTalioFirestore } from '../../lib/platform/firestore.server'

describe('separate explicit Firestore data connection', () => {
  beforeEach(() => { jest.clearAllMocks(); getApps.mockReturnValue([]) })
  test('fails closed without explicit project and server credentials', () => {
    expect(() => getTalioFirestore({})).toThrow('FIRESTORE_PROJECT_ID')
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms' })).toThrow('FIRESTORE_SERVICE_ACCOUNT_JSON')
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_SERVICE_ACCOUNT_JSON: 'invalid' })).toThrow('Invalid Firestore server credential')
    expect(initializeApp).not.toHaveBeenCalled()
  })
  test('does not reuse the notification Firebase app', () => {
    getApps.mockReturnValue([{ name: '[DEFAULT]', options: { projectId: 'notifications-project' } }])
    expect(getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' })).toBe('firestore-client')
    expect(initializeApp).toHaveBeenCalledWith({ projectId: 'talio-hrms', credential: {} }, 'talio-firestore-data')
    expect(getFirestore).toHaveBeenCalledWith(expect.objectContaining({ name: 'talio-firestore-data' }), '(default)')
  })
  test('reuses the data connection but never silently changes projects', () => {
    const app = { name: 'talio-firestore-data', options: { projectId: 'talio-hrms' } }
    getApps.mockReturnValue([app])
    getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms' })
    expect(cert).not.toHaveBeenCalled()
    expect(getFirestore).toHaveBeenCalledWith(app, '(default)')
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'another-project' })).toThrow('project changed')
  })
})
