import { createHash, randomBytes } from 'node:crypto'
import { MongoFieldPath as FieldPath } from './mongoFieldPath.server'
import { getFirestoreProvisioningContext } from './firestoreApplication.server'
import { applicationRecordKey, encodeApplicationRecord, decodeApplicationRecord, partIds, recordDigest } from './firestoreCodec.cjs'
import { projectNativeRecord } from './searchProjection.cjs'
import { assetReturnRecord } from '../assetHistory'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const field = name => new FieldPath('data', name)
const hash = value => createHash('sha256').update(value).digest('hex')
const SELF_FIELDS = new Set(['firstName', 'lastName', 'bio', 'phone', 'dateOfBirth', 'gender', 'maritalStatus', 'address', 'emergencyContact', 'bloodGroup', 'profilePicture', 'profilePictureFileId', 'profilePictureViewport', 'skills', 'qualifications', 'experience'])

/** Cross-scope employee/account mutation. Registry, login identity, unique
 * claims, asset returns and quota updates are committed together. The caller
 * supplies a validated patch and the digest of the employee it validated. */
export async function mutateFirestoreEmployee({ actor, databaseName, employeeId, expectedDigest, patch = {}, systemRole, remove = false }, { context } = {}) {
  const { firestore, dataset, catalog } = context || await getFirestoreProvisioningContext()
  if (!catalog.tenants?.some(tenant => tenant.databaseName === databaseName && tenant.active !== false)) fail('Tenant is unavailable', 403)
  if (!/^[a-f\d]{24}$/i.test(employeeId || '')) fail('Invalid employee ID')
  const root = firestore.collection('talioDatasets').doc(dataset)
  const collection = (db, name) => root.collection('databases').doc(db).collection('collections').doc(name).collection('records')
  const reference = (db, name, id) => collection(db, name).doc(applicationRecordKey(String(id)))
  const system = 'talio_superadmin'
  return firestore.runTransaction(async tx => {
    const reads = new Map(), pending = []
    async function decode(snapshot) {
      if (!snapshot.exists) return null
      const envelope = snapshot.data(), ids = partIds(envelope)
      const fragments = ids.length ? await tx.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
      const value = decodeApplicationRecord(envelope, new Map(fragments.map(part => [part.id, part.data()])))
      reads.set(snapshot.ref.path, { envelope, value })
      return value
    }
    async function get(db, name, id) { return decode(await tx.get(reference(db, name, id))) }
    async function find(db, name, filters, limit = 2) {
      let query = collection(db, name)
      for (const [key, value] of filters) query = query.where(field(key), '==', value)
      const result = await tx.get(query.limit(limit + 1))
      if (result.size > limit) fail('Too many related records for an atomic employee update', 409)
      return Promise.all(result.docs.map(decode))
    }
    function stage(db, name, current, next) {
      const ref = reference(db, name, current._id)
      pending.push({ db, name, ref, previous: reads.get(ref.path)?.envelope, current, next: next ? projectNativeRecord(name, next) : null })
    }
    const actualActor = await get(databaseName, 'users', actor._id || actor.userId)
    if (!actualActor?.isActive) fail('Account is inactive', 403)
    const employee = await get(databaseName, 'employees', employeeId)
    if (!employee) fail('Employee not found', 404)
    if (expectedDigest && recordDigest(employee) !== expectedDigest) fail('Employee changed; refresh before saving', 409)
    const manages = ['admin', 'hr'].includes(actualActor.role)
    if (!manages && (String(actualActor.employeeId) !== employeeId || remove || systemRole || Object.keys(patch).some(key => !SELF_FIELDS.has(key)))) fail('Not permitted to update this employee', 403)
    const companies = await find(system, 'tenantcompanies', [['databaseName', databaseName]])
    if (companies.length !== 1 || !companies[0].isActive || ['suspended', 'paused'].includes(companies[0].serviceStatus)) fail('Company service is inactive', 403)
    const company = companies[0]
    const accounts = await find(databaseName, 'users', [['employeeId', employeeId]])
    if (accounts.length > 1) fail('Employee has multiple linked accounts; reconcile before editing', 409)
    const account = accounts[0]
    if (account?.role === 'admin' && (remove || systemRole && systemRole !== 'admin' || ['inactive', 'terminated', 'resigned'].includes(patch.status))) fail('Administrator access can only be changed by the platform administrator', 403)
    if (account?.role === 'admin' && actualActor.role !== 'admin') fail('Only an administrator can edit this account', 403)
    if (remove && account?._id === actualActor._id) fail('You cannot delete your own account', 403)
    if (systemRole && (!manages || systemRole === 'super_admin' || actualActor.role === 'hr' && systemRole === 'admin')) fail('You cannot assign this role', 403)
    const now = new Date(), nextEmployee = { ...employee, ...patch, _id: employeeId, updatedAt: now }
    if (nextEmployee.email) nextEmployee.email = String(nextEmployee.email).trim().toLowerCase()
    let nextAccount = account ? { ...account, updatedAt: now } : null
    if (systemRole) {
      if (!account) fail('No linked user account found')
      const roles = await find(databaseName, 'roles', [['name', systemRole]], 20)
      const role = roles.find(value => value.company && String(value.company) === String(nextEmployee.company)) || roles.find(value => !value.company)
      if (!role) fail('Selected system role was not found')
      nextAccount = { ...nextAccount, role: role.name, roleId: role._id, permissionsCache: {}, cacheUpdatedAt: null }
    }
    if (nextAccount) {
      if (Object.hasOwn(patch, 'email')) nextAccount.email = nextEmployee.email
      if (patch.company !== undefined) nextAccount.company = patch.company
      if (['inactive', 'terminated', 'resigned'].includes(patch.status)) nextAccount.isActive = false
      else if (patch.status === 'active' && employee.status !== 'active') nextAccount.isActive = true
      if (nextAccount.email !== account.email || nextAccount.role !== account.role || nextAccount.isActive !== account.isActive || remove) nextAccount.authVersion = Number(account.authVersion || 0) + 1
    }
    // Check all foreign-key edits within this same transaction as the save.
    for (const [key, name] of [['designation', 'designations'], ['department', 'departments'], ['company', 'companies'], ['reportingManager', 'employees'], ['assignedManager', 'employees'], ['assignedTeamLead', 'employees'], ['reportsTo', 'employees']]) {
      if (patch[key] && (String(patch[key]) === employeeId || !await get(databaseName, name, patch[key]))) fail(`Invalid ${key} reference`)
    }
    for (const id of patch.departments || []) if (!await get(databaseName, 'departments', id)) fail('Department not found')
    const mappingMatches = account ? await find(system, 'usertenantmappings', [['email', account.email]]) : []
    const mapping = mappingMatches.find(value => value.databaseName === databaseName)
    if (mappingMatches.some(value => value.databaseName !== databaseName)) fail('Account mapping belongs to another tenant', 409)
    const nextMapping = mapping && nextAccount ? { ...mapping, email: nextAccount.email, role: nextAccount.role, isActive: nextAccount.isActive, updatedAt: now } : null
    const deactivate = remove || ['inactive', 'terminated', 'resigned'].includes(patch.status)
    const assets = deactivate ? await find(databaseName, 'assets', [['assignedTo', employeeId]], 100) : []
    let quotaDelta = 0
    if (account?.isActive && (remove || !nextAccount.isActive)) quotaDelta = -1
    else if (account && !account.isActive && nextAccount?.isActive) quotaDelta = 1
    if (quotaDelta) {
      const active = await find(databaseName, 'users', [['isActive', true]], 10000)
      if (quotaDelta > 0 && active.length >= (company.subscription?.maxUsers || 10)) fail('Company user limit reached', 409)
      stage(system, 'tenantcompanies', company, { ...company, subscription: { ...company.subscription, currentUserCount: Math.max(0, active.length + quotaDelta) }, updatedAt: now })
    }
    stage(databaseName, 'employees', employee, remove ? null : nextEmployee)
    if (account) stage(databaseName, 'users', account, remove ? null : nextAccount)
    if (mapping) stage(system, 'usertenantmappings', mapping, remove ? null : nextMapping)
    else if (nextAccount && !remove) {
      const identity = { _id: randomBytes(12).toString('hex') }
      stage(system, 'usertenantmappings', identity, { ...identity, userId: nextAccount._id, email: nextAccount.email, role: nextAccount.role, isActive: nextAccount.isActive, databaseName, tenantCompanyId: String(company._id), companyName: company.name || '', companySlug: company.slug || '', createdAt: now, updatedAt: now })
    }
    for (const asset of assets) stage(databaseName, 'assets', asset, assetReturnRecord(asset, actualActor, {}, now, employee))
    // Reserve/release the same identity claims used by provisioning and the
    // regular native repositories, including imported rows without claims.
    const claims = new Map()
    for (const item of pending) {
      const fields = item.name === 'employees' ? ['email', 'employeeCode'] : ['users', 'usertenantmappings'].includes(item.name) ? ['email'] : []
      for (const key of fields) for (const [kind, value] of [['old', item.current], ['next', item.next]]) if (value?.[key]) {
        const claimRef = root.collection('databases').doc(item.db).collection('uniqueKeys').doc(hash(JSON.stringify([item.name, [key], [value[key]]])))
        const row = claims.get(claimRef.path) || { ref: claimRef, db: item.db, name: item.name, field: key, value: value[key] }
        row[kind] = `${item.name}/${item.current._id}`
        claims.set(claimRef.path, row)
      }
    }
    for (const claim of claims.values()) {
      const current = await tx.get(claim.ref)
      if (current.exists && current.get('owner') !== (claim.old || claim.next)) fail('Employee identity is already reserved', 409)
      if (claim.next) {
        const duplicates = await find(claim.db, claim.name, [[claim.field, claim.value]])
        if (duplicates.some(value => `${claim.name}/${value._id}` !== claim.next)) fail('Email or employee code is already in use', 409)
      }
    }
    const writes = pending.map(item => ({ ...item, encoded: item.next ? encodeApplicationRecord(item.next) : null }))
    let writeCount = claims.size, writeBytes = 0
    for (const item of writes) {
      writeCount += 1 + (item.encoded?.parts.length || 0) + partIds(item.previous || {}).length
      if (item.encoded) writeBytes += Buffer.byteLength(JSON.stringify(item.encoded.envelope)) + item.encoded.parts.reduce((total, part) => total + part.value.bytes.length, 0)
    }
    if (writeCount > 450 || writeBytes > 8 * 1024 * 1024) fail('Employee update exceeds the atomic transaction budget', 409)
    for (const item of writes) {
      if (item.encoded) tx.set(item.ref, { ...item.encoded.envelope, digest: recordDigest(item.next) })
      else tx.delete(item.ref)
      for (const part of item.encoded?.parts || []) tx.set(item.ref.collection('parts').doc(part.id), part.value)
      for (const id of partIds(item.previous || {})) if (!item.encoded?.parts.some(part => part.id === id)) tx.delete(item.ref.collection('parts').doc(id))
    }
    for (const claim of claims.values()) {
      if (claim.next) tx.set(claim.ref, { owner: claim.next })
      else tx.delete(claim.ref)
    }
    return { employee: remove ? employee : nextEmployee, user: remove ? null : nextAccount, userDeleted: remove && Boolean(account), assetsReturned: assets.length }
  })
}
