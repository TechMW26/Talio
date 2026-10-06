import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { compareStoredPassword, needsPasswordHashUpgrade } from '@/lib/passwordAuth'
import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { sendNotificationToUser } from '@/lib/firebaseNotification'

export const authQueryFields = {
  users: ['email'], usersessions: ['tokenId', 'user'],
  departments: ['head', 'heads'], productivitysessions: ['user'],
}

export async function getNativeAuthRepository(databaseName) {
  const database = await getFirestoreTenantDatabase(databaseName, {
    queryFields: authQueryFields,
    constraints: { users: [{ fields: ['email'] }], usersessions: [{ fields: ['tokenId'] }] },
  })
  async function unique(collection, field, value) {
    const { records } = await database.list(collection, { filters: [{ field, operator: '==', value }], limit: 2 })
    if (records.length > 1) throw new Error('Ambiguous authentication identity')
    return records[0] || null
  }
  async function allFor(collection, filter) {
    const records = []
    let cursor = null
    do {
      const page = await database.list(collection, { filters: [filter], limit: 100, ...(cursor ? { cursor } : {}) })
      records.push(...page.records)
      cursor = page.nextCursor
    } while (cursor)
    return records
  }
  return {
    database,
    findUser: email => unique('users', 'email', email.toLowerCase().trim()),
    findSession: tokenId => unique('usersessions', 'tokenId', tokenId),
    listUserSessions: userId => allFor('usersessions', { field: 'user', operator: '==', value: String(userId) }),
    async recordFailedLogin(id, maxAttempts, lockoutMs) {
      return database.mutate('users', String(id), current => {
        const loginAttempts = (current.loginAttempts || 0) + 1
        const now = new Date()
        return { ...current, loginAttempts, lastFailedLogin: now, ...(loginAttempts >= maxAttempts ? { lockUntil: new Date(now.getTime() + lockoutMs) } : {}) }
      })
    },
    async completeLogin(id, password) {
      // Recheck password and activation inside the transaction: password resets,
      // disabling an account or concurrent lockouts cannot race successful login.
      const result = await database.mutate('users', String(id), async current => {
        if (!current.isActive || (current.lockUntil && new Date(current.lockUntil).getTime() > Date.now())) throw new Error('Account is inactive or locked')
        if (!await compareStoredPassword(password, current.password)) throw new Error('Credentials changed; sign in again')
        const now = new Date()
        const next = { ...current, lastLogin: now, loginAttempts: 0, lockUntil: null }
        if (needsPasswordHashUpgrade(current.password)) next.password = await bcrypt.hash(password, 10)
        if (!current.forcePasswordChange && !current.profileCompletion?.firstLoginAt) {
          next.profileCompletion = { ...current.profileCompletion, firstLoginAt: now, profileCompletionDeadline: new Date(now.getTime() + 7 * 86400000) }
        }
        return next
      })
      if (!result) throw new Error('Account no longer exists')
      return result
    },
    async createSession(values) {
      const now = new Date()
      if (!values?.user || !values.tokenId || !values.expiresAt || !Number.isFinite(new Date(values.expiresAt).getTime()) || new Date(values.expiresAt) <= now) throw new TypeError('Session user, token and future expiry are required')
      return database.create('usersessions', { _id: randomBytes(12).toString('hex'), lastActivityAt: now, ...values, isActive: true, createdAt: now, updatedAt: now })
    },
    async refreshSession(payload, expiresAt) {
      return database.transaction(async tx => {
        const account = await tx.get('users', String(payload.userId))
        const reject = () => { throw Object.assign(new Error('Session is expired, revoked or credentials changed'), { status: 401 }) }
        if (!account?.isActive || (Number(account.authVersion) || 0) !== (Number(payload.authVersion) || 0)) reject()
        if (payload.tokenId) {
          const { records } = await tx.list('usersessions', { filters: [{ field: 'tokenId', operator: '==', value: payload.tokenId }], limit: 2 })
          const session = records[0]
          const expiry = session?.expiresAt ? new Date(session.expiresAt).getTime() : NaN
          if (records.length !== 1 || !session.isActive || String(session.user) !== String(account._id) || !Number.isFinite(expiry) || expiry <= Date.now()) reject()
          const now = new Date()
          await tx.replace('usersessions', { ...session, expiresAt, lastActivityAt: now, updatedAt: now })
        }
        return account
      })
    },
    async getEmployee(id) {
      const employee = await database.get('employees', String(id))
      if (!employee) return null
      const [designation, department, manager] = await Promise.all([
        employee.designation ? database.get('designations', String(employee.designation)) : null,
        employee.department ? database.get('departments', String(employee.department)) : null,
        employee.reportingManager ? database.get('employees', String(employee.reportingManager)) : null,
      ])
      return { ...employee, designation, department, reportingManager: manager ? { _id: manager._id, firstName: manager.firstName, lastName: manager.lastName, email: manager.email } : null }
    },
    async getCompanySettings() { return (await database.list('companysettings', { limit: 1 })).records[0] || null },
    async getHeadDepartments(employeeId) {
      const [primary, additional] = await Promise.all([
        allFor('departments', { field: 'head', operator: '==', value: String(employeeId) }),
        allFor('departments', { field: 'heads', operator: 'array-contains', value: String(employeeId) }),
      ])
      return [...new Map([...primary, ...additional].filter(department => department.isActive).map(department => [department._id, department])).values()]
    },
    async syncHeadDepartments(userId, headOfDepartments) {
      return database.mutate('users', String(userId), current => ({ ...current, isDepartmentHead: true, headOfDepartments, updatedAt: new Date() }))
    },
    async pendingProductivitySessions(userId) {
      const records = await allFor('productivitysessions', { field: 'user', operator: '==', value: String(userId) })
      return records.filter(record => record.analysis?.isAnalyzed !== true && record.screenshots?.length).map(record => record._id)
    },
    async revokeSession(tokenId, reason = 'user_logout') {
      const session = await unique('usersessions', 'tokenId', tokenId)
      if (session) await database.mutate('usersessions', session._id, current => ({ ...current, isActive: false, revokedReason: reason, revokedAt: new Date(), updatedAt: new Date() }))
    },
    async sendLoginPush(user, title, body) {
      const result = await sendNotificationToUser(user, { title, body }, { url: '/dashboard', type: 'system', eventType: 'login', icon: '/icon-192x192.png', loginTime: new Date().toISOString() })
      const now = new Date()
      await database.create('notifications', { _id: randomBytes(12).toString('hex'), user: user._id, title, message: body, type: 'system', url: '/dashboard', icon: '/icon-192x192.png', read: false, createdAt: now, updatedAt: now, deliveryStatus: { fcm: { sent: result?.success || false, sentAt: result?.success ? now : null }, socketIO: { sent: false } } })
      if (result?.tokensToRemove?.length) await database.mutate('users', user._id, current => ({ ...current, fcmTokens: (current.fcmTokens || []).filter(entry => !result.tokensToRemove.includes(entry.token)) }))
      return result
    },
  }
}

export function parseSessionUserAgent(userAgent = '') {
  const ua = String(userAgent).toLowerCase()
  const desktopApp = /talio desktop|electron/.test(ua), androidApp = /talio android|talio-android/.test(ua)
  const device = desktopApp ? 'desktop' : /tablet|ipad/.test(ua) ? 'tablet' : /mobile|android|iphone/.test(ua) ? 'mobile' : 'desktop'
  const browserPatterns = [['Talio Desktop', /electron\/([\d.]+)/], ['Edge', /edg\/([\d.]+)/], ['Chrome', /chrome(?:\/([\d.]+))?/], ['Firefox', /firefox(?:\/([\d.]+))?/], ['Safari', /version\/([\d.]+).*safari/]]
  const matched = browserPatterns.find(([, pattern]) => pattern.test(ua))
  let os = 'Unknown', osVersion = ''
  if (/android/.test(ua)) { os = 'Android'; osVersion = ua.match(/android ([\d.]+)/)?.[1] || '' }
  else if (/iphone|ipad/.test(ua)) { os = 'iOS'; osVersion = (ua.match(/os ([\d_]+)/)?.[1] || '').replace(/_/g, '.') }
  else if (/windows/.test(ua)) { os = 'Windows'; osVersion = ua.includes('windows nt 10') ? '10/11' : ua.match(/windows nt ([\d.]+)/)?.[1] || '' }
  else if (/mac os x|macos/.test(ua)) { os = 'macOS'; osVersion = (ua.match(/mac os x ([\d._]+)/)?.[1] || '').replace(/_/g, '.') }
  else if (/linux/.test(ua)) os = 'Linux'
  return { userAgent: userAgent || 'Unknown', browser: matched?.[0] || (/safari/.test(ua) ? 'Safari' : 'Unknown'), browserVersion: matched ? ua.match(matched[1])?.[1] || '' : '', os, osVersion, device, deviceType: desktopApp ? 'Desktop App' : androidApp ? 'Android App' : 'Web Browser', isMobile: device !== 'desktop' }
}
