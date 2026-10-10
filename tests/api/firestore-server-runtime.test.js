import fs from 'node:fs'
import path from 'node:path'
import { getTalioFirestore } from '@/lib/platform/firestore.server'

describe('retired application Firestore entrypoint fails closed', () => {
  test('default and legacy source configuration cannot open a runtime connection', () => {
    expect(() => getTalioFirestore()).toThrow('retired')
    expect(() => getTalioFirestore({ FIRESTORE_PROJECT_ID: 'former-data-project', FIRESTORE_SERVICE_ACCOUNT_JSON: '{}' })).toThrow('verified MongoDB')
  })
  test('retired entrypoint imports no Firebase SDK and retains no initialization fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/platform/firestore.server.js'), 'utf8')
    expect(source).not.toMatch(/from ['"]firebase-admin\//)
    expect(source).not.toMatch(/initializeApp\(|getFirestore\(/)
  })
})
