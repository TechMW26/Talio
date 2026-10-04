import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APP_NAME = 'talio-firestore-data'

// Intentionally separate from the existing Firebase notification project/app.
// No fallback to MongoDB or to an implicitly selected Firebase project.
export function getTalioFirestore(env = process.env) {
  if (typeof window !== 'undefined') throw new Error('Firestore data access is server-only')
  const projectId = env.FIRESTORE_PROJECT_ID
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('FIRESTORE_PROJECT_ID must explicitly identify the data project')
  }
  let app = getApps().find(candidate => candidate.name === APP_NAME)
  if (app && app.options.projectId !== projectId) throw new Error('Firestore data project changed within one process')
  if (!app) {
    if (!env.FIRESTORE_SERVICE_ACCOUNT_JSON) throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON is required for server data access')
    let credential
    try { credential = cert(JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON)) } catch {
      throw new Error('Invalid Firestore server credential configuration')
    }
    app = initializeApp({ projectId, credential }, APP_NAME)
  }
  return getFirestore(app, env.FIRESTORE_DATABASE_ID || '(default)')
}
