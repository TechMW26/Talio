import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { compareStoredPassword } from '@/lib/passwordAuth'
import { getFirestoreTenantDatabase } from './firestoreApplication.server'

const tokenHash = token => createHash('sha256').update(token).digest('hex')
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_RESET' })

export async function getNativePasswordRepository(databaseName) {
  const database = await getFirestoreTenantDatabase(databaseName, {
    queryFields: { passwordresettokens: ['user', 'tokenHash'], usersessions: ['user'] },
    constraints: { passwordresettokens: [{ fields: ['tokenHash'] }] },
  })
  async function findToken(raw) {
    const { records } = await database.list('passwordresettokens', { filters: [{ field: 'tokenHash', operator: '==', value: tokenHash(raw) }], limit: 2 })
    if (records.length !== 1) return null
    return records[0]
  }
  function validate(token, user) {
    if (!token || token.usedAt || !token.expiresAt || new Date(token.expiresAt).getTime() <= Date.now()) throw invalid('This reset link has expired or already been used')
    if (!user?.isActive) throw invalid('User account not found or deactivated')
    if (user.currentPasswordResetId && user.currentPasswordResetId !== token._id) throw invalid('This reset link has been replaced by a newer request')
  }
  return {
    async issue(userId, { ipAddress, userAgent, windowMs, maxRequests, expiresInMs = 15 * 60000 }) {
      const raw = randomBytes(32).toString('hex')
      const id = randomBytes(12).toString('hex')
      const hash = tokenHash(raw)
      // Imported history seeds the first native request; subsequent requests use
      // a small transactional user ledger, so concurrent callers cannot exceed it.
      const historic = []
      let cursor = null
      do {
        const page = await database.list('passwordresettokens', { filters: [{ field: 'user', operator: '==', value: String(userId) }], limit: 100, ...(cursor ? { cursor } : {}) })
        historic.push(...page.records.map(row => row.createdAt).filter(Boolean))
        cursor = page.nextCursor
      } while (cursor)
      return database.transaction(async tx => {
        const user = await tx.get('users', String(userId))
        if (!user?.isActive) throw invalid('Account is inactive')
        const now = new Date()
        const recent = (user.passwordResetRequests || historic).map(value => new Date(value)).filter(value => value.getTime() >= now.getTime() - windowMs)
        if (recent.length >= maxRequests) return null
        const expiresAt = new Date(now.getTime() + expiresInMs)
        await tx.create('passwordresettokens', { _id: id, user: String(userId), token: hash, tokenHash: hash, createdAt: now, expiresAt, usedAt: null, requestedFromIp: ipAddress, requestedUserAgent: userAgent })
        await tx.replace('users', { ...user, currentPasswordResetId: id, passwordResetRequests: [...recent, now] })
        return { token: raw, expiresAt }
      })
    },
    async validate(raw) {
      const token = await findToken(raw)
      const user = token ? await database.get('users', String(token.user)) : null
      validate(token, user)
      return { token, user }
    },
    async reset(raw, password, { ipAddress, userAgent }) {
      const found = await findToken(raw)
      if (!found) throw invalid('Invalid or expired reset link')
      const passwordHash = await bcrypt.hash(password, 10)
      return database.transaction(async tx => {
        const token = await tx.get('passwordresettokens', found._id)
        const user = token ? await tx.get('users', String(token.user)) : null
        validate(token, user)
        if (await compareStoredPassword(password, user.password)) throw invalid('New password must be different from your current password')
        const now = new Date()
        const updated = { ...user, password: passwordHash, forcePasswordChange: false, encryptedOnboardingPassword: null, passwordChangedAt: now, authVersion: (Number(user.authVersion) || 0) + 1, passwordResetToken: null, passwordResetExpires: null, currentPasswordResetId: null, loginAttempts: 0, lockUntil: null, updatedAt: now }
        await tx.replace('users', updated)
        await tx.replace('passwordresettokens', { ...token, usedAt: now, usedFromIp: ipAddress, usedUserAgent: userAgent })
        // authVersion atomically invalidates ALL old JWTs, including a
        // session created concurrently or a legacy token without a session row.
        return updated
      })
    },
    async change(userId, currentPassword, newPassword) {
      const passwordHash = await bcrypt.hash(newPassword, 10)
      const user = await database.mutate('users', String(userId), async current => {
        if (!current.isActive) throw invalid('Account has been deactivated')
        if (!await compareStoredPassword(currentPassword, current.password)) throw invalid('Current password is incorrect')
        const now = new Date()
        return { ...current, password: passwordHash, forcePasswordChange: false, encryptedOnboardingPassword: null, passwordChangedAt: now, updatedAt: now }
      })
      if (!user) throw invalid('User not found')
      return user
    },
    async adminReset(actorId, userId, password, { encryptedOnboardingPassword = null } = {}) {
      if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) throw Object.assign(new Error('Password must be 8 to 72 bytes long'), { status: 400 })
      const hash = await bcrypt.hash(password, 10)
      return database.transaction(async tx => {
        const actor = await tx.get('users', String(actorId)), target = await tx.get('users', String(userId))
        if (!actor?.isActive || !['admin', 'hr'].includes(actor.role)) throw Object.assign(new Error('Password reset is not permitted'), { status: 403 })
        if (!target) throw Object.assign(new Error('User not found'), { status: 404 })
        if (actor.role === 'hr' && ['admin', 'super_admin'].includes(target.role)) throw Object.assign(new Error('Only an admin can reset administrator credentials'), { status: 403 })
        const next = { ...target, password: hash, encryptedOnboardingPassword, forcePasswordChange: true, authVersion: (Number(target.authVersion) || 0) + 1, currentPasswordResetId: null, passwordResetToken: null, passwordResetExpires: null, loginAttempts: 0, lockUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() }
        await tx.replace('users', next)
        return next
      })
    },
  }
}
