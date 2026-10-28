import { createHash } from 'node:crypto'
import { startMiraLink, inspectMiraLink, approveMiraLink, pollMiraLink, readMiraLinkGrant, revokeMiraLink, LINK_DEVICES, LINK_GRANTS } from '@/lib/miraAccountLink.server'

function store() {
  let rows = new Map(), queue = Promise.resolve()
  const api = target => ({
    get: async (collection, id) => structuredClone(target.get(collection + ':' + id)),
    create: async (collection, row) => { const key = collection + ':' + row._id; if (target.has(key)) throw Error('duplicate'); target.set(key, structuredClone(row)); return row },
    replace: async (collection, row) => { target.set(collection + ':' + row._id, structuredClone(row)); return row },
  })
  return { get: (...args) => api(rows).get(...args), create: (...args) => api(rows).create(...args),
    mutate: async (collection, id, fn) => { const row = fn(await api(rows).get(collection, id)); return api(rows).replace(collection, row) },
    transaction: fn => { const result = queue.then(async () => { const next = structuredClone(rows), value = await fn(api(next)); rows = next; return value }); queue = result.catch(() => {}); return result },
    snapshot: () => JSON.stringify([...rows.values()]),
  }
}
const now = Date.parse('2026-10-28T06:00:00Z')
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url')
const auth = { user: { _id: 'owner', authVersion: 2, name: 'Owner' }, tenant: { databaseName: 'talio_company_one', companyName: 'Company One' } }
const pollArgs = pair => ({ userCode: pair.user_code, deviceCode: pair.device_code, verifier })
beforeEach(() => { process.env.JWT_SECRET = 'link-test-secret-with-at-least-32-characters' })

test('pairing validates challenge/scopes and persists no raw device secret', async () => {
  const database = store()
  await expect(startMiraLink(database, { challenge: 'plain-text', allowActions: true }, now)).rejects.toThrow('invalid_challenge')
  await expect(startMiraLink(database, { challenge, allowActions: 'true' }, now)).rejects.toThrow('invalid_scope')
  const pair = await startMiraLink(database, { challenge, allowActions: false }, now)
  expect(database.snapshot()).not.toContain(pair.device_code)
  expect(await inspectMiraLink(database, pair.user_code, now)).toMatchObject({ status: 'pending', scopes: ['workplace:read'] })
})
test('approval binds only the authenticated owner/tenant and preserves requested scopes', async () => {
  const database = store(), pair = await startMiraLink(database, { challenge, allowActions: false }, now)
  await approveMiraLink(database, auth, { userCode: pair.user_code, approve: true, owner: 'attacker', tenant: 'foreign', scopes: ['workplace:act'] }, now + 100)
  const result = await pollMiraLink(database, pollArgs(pair), now + 5001)
  const grant = await readMiraLinkGrant(database, result.access_token, now + 5001)
  expect(grant).toMatchObject({ owner: 'owner', tenant: 'talio_company_one', authVersion: 2, scopes: ['workplace:read'] })
  expect(database.snapshot()).not.toContain(result.access_token)
  expect(result).not.toHaveProperty('userId')
  await expect(approveMiraLink(database, { ...auth, user: { _id: 'other' } }, { userCode: pair.user_code, approve: true }, now + 200)).rejects.toThrow('already_decided')
})
test('wrong device secret or verifier cannot consume an approved request', async () => {
  const database = store(), pair = await startMiraLink(database, { challenge, allowActions: true }, now)
  await approveMiraLink(database, auth, { userCode: pair.user_code, approve: true }, now + 100)
  await expect(pollMiraLink(database, { ...pollArgs(pair), deviceCode: 'x'.repeat(43) }, now + 6000)).rejects.toThrow('invalid_grant')
  await expect(pollMiraLink(database, { ...pollArgs(pair), verifier: 'x'.repeat(43) }, now + 6000)).rejects.toThrow('invalid_grant')
  const results = await Promise.allSettled([pollMiraLink(database, pollArgs(pair), now + 6000), pollMiraLink(database, pollArgs(pair), now + 6000)])
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(row => row.status === 'rejected')).toHaveLength(1)
})
test('pending and early polls enforce persistent backoff', async () => {
  const database = store(), pair = await startMiraLink(database, { challenge, allowActions: false }, now)
  expect(await pollMiraLink(database, pollArgs(pair), now + 100)).toEqual({ error: 'slow_down', interval: 10 })
  expect(await pollMiraLink(database, pollArgs(pair), now + 10200)).toEqual({ error: 'authorization_pending', interval: 10 })
  expect(await pollMiraLink(database, pollArgs(pair), now + 10300)).toEqual({ error: 'slow_down', interval: 15 })
})
test('declined and expired requests never issue credentials', async () => {
  const database = store(), pair = await startMiraLink(database, { challenge, allowActions: false }, now)
  await approveMiraLink(database, auth, { userCode: pair.user_code, approve: false }, now + 100)
  await expect(pollMiraLink(database, pollArgs(pair), now + 6000)).rejects.toThrow('access_denied')
  await expect(inspectMiraLink(database, pair.user_code, now + 300001)).rejects.toThrow('expired_token')
  await expect(approveMiraLink(database, auth, { userCode: pair.user_code, approve: true }, now + 300001)).rejects.toThrow('expired_token')
  expect(database.snapshot()).not.toContain(LINK_GRANTS)
})
test('revocation and expiry invalidate tokens immediately; login JWTs are not link grants', async () => {
  const database = store(), pair = await startMiraLink(database, { challenge, allowActions: true }, now)
  await approveMiraLink(database, auth, { userCode: pair.user_code, approve: true }, now + 1)
  const result = await pollMiraLink(database, pollArgs(pair), now + 6000)
  const grant = await readMiraLinkGrant(database, result.access_token, now + 6000)
  await expect(readMiraLinkGrant(database, result.access_token, result.expires_at)).rejects.toThrow('invalid_grant')
  await revokeMiraLink(database, grant)
  await expect(readMiraLinkGrant(database, result.access_token, now + 7000)).rejects.toThrow('invalid_grant')
  await expect(readMiraLinkGrant(database, 'header.payload.signature', now)).rejects.toThrow('invalid_grant')
  expect(database.snapshot()).toContain('consumed')
  expect(database.snapshot()).toContain('"sealedToken":null')
})
