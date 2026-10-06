import { google } from 'googleapis'
import { collectFirestorePages } from './platform/firestoreQueries.server'
export const MAIL_ACCOUNT_OPTIONS = { queryFields: { emailaccounts: ['user', 'isConnected'] }, constraints: { emailaccounts: [{ fields: ['user', 'email'] }] } }
const id = user => String(user?._id || user?.userId || user)
export async function listMailAccounts(database, user) { return collectFirestorePages(database, 'emailaccounts', { filters: [{ field: 'user', operator: '==', value: id(user) }, { field: 'isConnected', operator: '==', value: true }] }) }
export async function getMailAccount(database, user, accountId) {
  if (accountId) { const row = await database.get('emailaccounts', String(accountId)); return row?.user === id(user) && row.isConnected ? row : null }
  const rows = await listMailAccounts(database, user); return rows.find(row => row.isPrimary) || rows[0] || null
}
export async function updateMailAccount(database, user, accountId, values) {
  const allowed = ['accessToken', 'refreshToken', 'tokenExpiry', 'unreadCount', 'spamCount', 'lastSynced', 'syncError'], patch = Object.fromEntries(allowed.filter(key => values[key] !== undefined).map(key => [key, values[key]]))
  return database.mutate('emailaccounts', accountId, row => { if (!row || row.user !== id(user) || !row.isConnected) throw Object.assign(new Error('Email account is unavailable'), { status: 403 }); return { ...row, ...patch, updatedAt: new Date() } })
}
export async function disconnectMailAccount(database, user, accountId) {
  const account = await getMailAccount(database, user, accountId)
  if (!account) return null
  return database.mutate('emailaccounts', account._id, row => { if (!row || row.user !== id(user)) throw Object.assign(new Error('Email account is unavailable'), { status: 403 }); return { ...row, isConnected: false, accessToken: null, refreshToken: null, tokenExpiry: null, disconnectedAt: new Date() } })
}
export async function getAuthenticatedMailClient(database, user, emailAccount) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') throw Object.assign(new Error('External Gmail access is disabled during local migration acceptance'), { status: 503, code: 'LOCAL_ACCEPTANCE_DELIVERY_DISABLED' })
  const current = await getMailAccount(database, user, emailAccount._id)
  if (!current) throw Object.assign(new Error('Email account is unavailable'), { status: 403 })
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, 'https://app.talio.in/api/auth/google/callback')
  client.setCredentials({ access_token: current.accessToken, refresh_token: current.refreshToken, expiry_date: current.tokenExpiry ? +new Date(current.tokenExpiry) : undefined })
  if (current.tokenExpiry && Date.now() >= +new Date(current.tokenExpiry)) {
    const { credentials } = await client.refreshAccessToken()
    await updateMailAccount(database, user, current._id, { accessToken: credentials.access_token, ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}), tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null })
  }
  return client
}
