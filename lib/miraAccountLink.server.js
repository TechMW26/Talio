import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export const LINK_DEVICES = 'miralinkdevices'
export const LINK_GRANTS = 'miralinkgrants'
export const LINK_STORE_OPTIONS = { queryFields: { [LINK_GRANTS]: ['owner', 'tenant'] } }
export const LINK_LIFETIME = 30 * 86400_000
const hash = value => createHash('sha256').update(String(value)).digest('hex')
const id = value => hash(value).slice(0, 24)
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status, code }) }
const key = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) fail('link_not_configured', 503)
  return createHash('sha256').update('mira-device-v1:' + process.env.JWT_SECRET).digest()
}
function seal(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv)
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url')
}
function unseal(value) {
  const bytes = Buffer.from(value, 'base64url'), cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(-16))
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString())
}
export function normalizedLinkCode(value) {
  const code = String(value || '').toUpperCase().replace(/-/g, '')
  if (!/^[A-F0-9]{10}$/.test(code)) fail('invalid_user_code')
  return code
}
export async function startMiraLink(system, input, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.challenge || '')) fail('invalid_challenge')
  if (typeof input.allowActions !== 'boolean') fail('invalid_scope')
  const deviceCode = randomBytes(32).toString('base64url'), userCode = randomBytes(5).toString('hex').toUpperCase()
  await system.create(LINK_DEVICES, { _id: id(userCode), deviceHash: hash(deviceCode), challenge: input.challenge,
    scopes: ['workplace:read', ...(input.allowActions ? ['workplace:act'] : [])], status: 'pending', expiresAt: now + 300_000,
    createdAt: new Date(now), interval: 5, nextPollAt: now + 5000 })
  return { device_code: deviceCode, user_code: userCode.slice(0, 5) + '-' + userCode.slice(5), expires_in: 300, interval: 5 }
}
export async function inspectMiraLink(system, code, now = Date.now()) {
  const row = await system.get(LINK_DEVICES, id(normalizedLinkCode(code)))
  if (!row || row.expiresAt <= now) fail('expired_token')
  return { status: row.status, scopes: row.scopes, expiresAt: row.expiresAt }
}
export async function approveMiraLink(system, auth, { userCode, approve }, now = Date.now()) {
  if (typeof approve !== 'boolean') fail('invalid_approval')
  const owner = String(auth.user?._id || ''), tenant = auth.tenant?.databaseName
  if (!owner || !tenant) fail('unauthorized', 401)
  return system.transaction(async tx => {
    const row = await tx.get(LINK_DEVICES, id(normalizedLinkCode(userCode)))
    if (!row || row.expiresAt <= now) fail('expired_token')
    if (row.status !== 'pending') fail('already_decided', 409)
    if (!approve) { await tx.replace(LINK_DEVICES, { ...row, status: 'denied' }); return { approved: false } }
    const token = randomBytes(32).toString('base64url'), grantId = id(token)
    const profile = { name: String(auth.user.name || auth.user.email || 'Talio user').slice(0, 120), company: String(auth.tenant.companyName || '').slice(0, 120) }
    await tx.create(LINK_GRANTS, { _id: grantId, owner, tenant, authVersion: Number(auth.user.authVersion) || 0,
      companySlug: auth.tenant.companySlug, companyName: auth.tenant.companyName, scopes: row.scopes,
      createdAt: new Date(now), expiresAt: now + LINK_LIFETIME, revoked: false })
    await tx.replace(LINK_DEVICES, { ...row, status: 'approved', grantId, sealedToken: seal({ token, profile }) })
    return { approved: true }
  })
}
export async function pollMiraLink(system, { userCode, deviceCode, verifier }, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode || '') || !/^[A-Za-z0-9_-]{43}$/.test(verifier || '')) fail('invalid_grant')
  return system.transaction(async tx => {
    const row = await tx.get(LINK_DEVICES, id(normalizedLinkCode(userCode)))
    if (!row || row.deviceHash !== hash(deviceCode) || row.challenge !== createHash('sha256').update(verifier).digest('base64url')) fail('invalid_grant')
    if (row.expiresAt <= now) fail('expired_token')
    if (row.status === 'denied') fail('access_denied')
    if (row.status === 'consumed') fail('invalid_grant')
    if (row.nextPollAt > now) {
      const interval = row.interval + 5
      await tx.replace(LINK_DEVICES, { ...row, interval, nextPollAt: now + interval * 1000 })
      return { error: 'slow_down', interval }
    }
    if (row.status === 'pending') {
      await tx.replace(LINK_DEVICES, { ...row, nextPollAt: now + row.interval * 1000 })
      return { error: 'authorization_pending', interval: row.interval }
    }
    const grant = await tx.get(LINK_GRANTS, row.grantId)
    if (!grant || grant.revoked || grant.expiresAt <= now) fail('invalid_grant')
    const result = unseal(row.sealedToken)
    await tx.replace(LINK_DEVICES, { ...row, status: 'consumed', sealedToken: null })
    return { access_token: result.token, token_type: 'Bearer', expires_at: grant.expiresAt, profile: result.profile, scopes: grant.scopes }
  })
}
export async function readMiraLinkGrant(system, token, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) fail('invalid_grant', 401)
  const grant = await system.get(LINK_GRANTS, id(token))
  if (!grant || grant.revoked || grant.expiresAt <= now) fail('invalid_grant', 401)
  return grant
}
export async function revokeMiraLink(system, grant) {
  await system.mutate(LINK_GRANTS, grant._id, row => {
    if (!row || row.owner !== grant.owner || row.tenant !== grant.tenant) fail('invalid_grant', 401)
    return { ...row, revoked: true, revokedAt: new Date() }
  })
}
