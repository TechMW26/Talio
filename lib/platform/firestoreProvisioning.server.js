import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { FieldPath } from 'firebase-admin/firestore'
import { getFirestoreProvisioningContext } from './firestoreApplication.server'
import { applicationRecordKey, encodeApplicationRecord, decodeApplicationRecord, partIds } from './firestoreCodec.cjs'
import { encryptPassword } from '../passwordEncryption'
import { employeeSearchGrams } from '../employees.server'

const id = () => randomBytes(12).toString('hex')
const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const field = value => new FieldPath('data', ...value.split('.'))

/** Only account provisioning crosses the system/tenant boundary. All registry,
 * quota, setup-code, account and employee writes commit in ONE Firestore transaction.
 * No external notification, password hashing, or upload runs in the retry callback.
 */
export async function provisionFirestoreAccount(input, { actor, superadmin, setupCode, tokenId, context, preparedEmployee, preparedUser, candidateId } = {}) {
  const { email, password, employeeData } = input || {}
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 320) fail('Invalid email address')
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) fail('Password must be 8 to 72 bytes long')
  const normalizedEmail = email.trim().toLowerCase()
  if (candidateId && (!/^[a-f0-9]{24}$/i.test(candidateId) || setupCode || superadmin || !employeeData)) fail('Invalid candidate conversion context')
  if (!setupCode && !superadmin && (!actor?.databaseName || !['admin', 'hr'].includes(actor.role))) fail('Only an authenticated tenant administrator can register an account', 403)
  if (superadmin && (!superadmin._id || !superadmin.companyId)) fail('Superadmin company context is required', 403)
  const role = setupCode || superadmin ? 'admin' : input.role || 'employee'
  if (!['admin', 'hr', 'manager', 'employee', 'department_head', 'team_lead'].includes(role) || (actor?.role === 'hr' && role === 'admin')) fail('You cannot assign this role', 403)
  const employeeInput = setupCode ? { firstName: input.firstName, lastName: input.lastName, employeeCode: 'ADMIN-001' } : employeeData
  const requiredEmployeeFields = superadmin ? ['firstName', 'employeeCode'] : ['firstName', 'lastName', 'employeeCode']
  if (employeeInput && requiredEmployeeFields.some(key => typeof employeeInput[key] !== 'string' || !employeeInput[key].trim())) fail('Employee first name, last name and employee code are required')
  const passwordHash = await bcrypt.hash(password, 10)
  const encryptedOnboardingPassword = setupCode ? undefined : encryptPassword(password)
  const { firestore, dataset, catalog } = context || await getFirestoreProvisioningContext()
  const root = firestore.collection('talioDatasets').doc(dataset)
  const dbRoot = name => root.collection('databases').doc(name)
  const collection = (db, name) => dbRoot(db).collection('collections').doc(name).collection('records')
  const system = 'talio_superadmin'
  const userId = id(), employeeId = employeeInput ? id() : null, mappingId = id(), sessionId = id()
  const now = new Date()
  return firestore.runTransaction(async tx => {
    async function read(snapshot) {
      if (!snapshot.exists) return null
      const envelope = snapshot.data(), ids = partIds(envelope)
      const pieces = ids.length ? await tx.getAll(...ids.map(key => snapshot.ref.collection('parts').doc(key))) : []
      return decodeApplicationRecord(envelope, new Map(pieces.map(piece => [piece.id, piece.data()])))
    }
    let companySnapshot
    if (superadmin) {
      const admin = await read(await tx.get(collection(system, 'superadmins').doc(applicationRecordKey(String(superadmin._id)))))
      if (!admin?.isActive || admin.permissions?.canCreateCompanies !== true) fail('Superadmin account provisioning is not permitted', 403)
      companySnapshot = await tx.get(collection(system, 'tenantcompanies').doc(applicationRecordKey(String(superadmin.companyId))))
      if (!companySnapshot.exists) fail('Company not found', 404)
    } else {
      const lookup = setupCode ? ['setupCode.code', setupCode] : ['databaseName', actor.databaseName]
      const companies = await tx.get(collection(system, 'tenantcompanies').where(field(lookup[0]), '==', lookup[1]).limit(2))
      if (companies.size !== 1) fail('Company not found or setup code is invalid')
      companySnapshot = companies.docs[0]
    }
    const company = await read(companySnapshot)
    const databaseName = company.databaseName
    if (!company.isActive || ['suspended', 'paused'].includes(company.serviceStatus)) fail('Company service is inactive', 403)
    if (!catalog.tenants?.some(tenant => tenant.databaseName === databaseName && tenant.tenantId === String(company._id) && tenant.active !== false)) fail('Company database has not been provisioned', 409)
    if (setupCode) {
      const expiry = new Date(company.setupCode?.expiresAt).getTime()
      if (company.isSetupComplete || company.setupCode?.isUsed || !Number.isFinite(expiry) || expiry <= now.getTime()) fail('Setup code is expired or already used', 409)
    } else if (!superadmin) {
      const actual = await read(await tx.get(collection(databaseName, 'users').doc(applicationRecordKey(String(actor._id || actor.userId)))))
      if (!actual?.isActive || !['admin', 'hr'].includes(actual.role) || (actual.role === 'hr' && role === 'admin')) fail('Registration permission has changed', 403)
    }
    const users = collection(databaseName, 'users')
    const mappings = collection(system, 'usertenantmappings')
    let candidateSnapshot = null, candidate = null
    if (candidateId) {
      candidateSnapshot = await tx.get(collection(databaseName, 'candidates').doc(applicationRecordKey(candidateId)))
      candidate = await read(candidateSnapshot)
      if (!candidate) fail('Candidate not found', 404)
      if (candidate.convertedEmployeeId) fail('Candidate has already been converted to an employee', 409)
      if (candidate.stage !== 'hired' && candidate.offer?.status !== 'accepted') fail('Candidate must be hired or have an accepted offer before conversion', 409)
      if (String(candidate.email || '').trim().toLowerCase() !== normalizedEmail) fail('Employee email must match the candidate email', 409)
      const jobId = String(candidate.jobPosting?._id || candidate.jobPosting || '')
      if (!jobId || !await read(await tx.get(collection(databaseName, 'jobpostings').doc(applicationRecordKey(jobId))))) fail('Candidate job no longer exists', 409)
      const managerId = String(preparedEmployee?.reportingManager?._id || preparedEmployee?.reportingManager || '')
      if (managerId) {
        const manager = await read(await tx.get(collection(databaseName, 'employees').doc(applicationRecordKey(managerId))))
        if (!manager || manager.isActive === false || !['active', 'probation'].includes(manager.status)) fail('Reporting manager is no longer active', 409)
      }
    }
    const [userMatch, mappingMatch, activeUsers, employeeMatch, employeeEmailMatch] = await Promise.all([
      tx.get(users.where(field('email'), '==', normalizedEmail).limit(1)),
      tx.get(mappings.where(field('email'), '==', normalizedEmail).limit(1)),
      tx.get(users.where(field('isActive'), '==', true).limit(10001)),
      employeeInput ? tx.get(collection(databaseName, 'employees').where(field('employeeCode'), '==', employeeInput.employeeCode.trim()).limit(1)) : null,
      employeeInput ? tx.get(collection(databaseName, 'employees').where(field('email'), '==', normalizedEmail).limit(1)) : null,
    ])
    if (!userMatch.empty || !mappingMatch.empty) fail('An account with this email already exists', 409)
    if (employeeMatch && !employeeMatch.empty) fail('Employee code already exists', 409)
    if (employeeEmailMatch && !employeeEmailMatch.empty) fail('Employee email already exists', 409)
    const maxUsers = company.subscription?.maxUsers || 10
    if (activeUsers.size >= maxUsers || activeUsers.size > 10000) fail('Company user limit reached', 409)
    const user = {
      profileCompletion: { status: 'incomplete', ocrVerification: { status: 'pending', mismatches: [] }, completedFields: { personalInfo: false, aadhaarUploaded: false, ocrVerified: false } },
      notificationPreferences: { chat: true, projects: true, leave: true, attendance: true, announcements: true },
      miraPreferences: { autoGreetingEnabled: true, voiceEnabled: true, voiceId: 'jJ0Hr51MaPgsgfPtFdR4', customInstructions: '', knowledge: '' },
      settings: { screenshotInterval: 4 },
      isDepartmentHead: false, headOfDepartments: [], isDepartmentManager: false, departmentManagerOf: [], teamLeaderOf: [], teamMemberOf: [],
      ...preparedUser, _id: userId, email: normalizedEmail, password: passwordHash, role, employeeId, isActive: true, forcePasswordChange: !setupCode, authVersion: 0, loginAttempts: 0, lockUntil: null, currentPasswordResetId: null, fcmTokens: [], createdAt: now, updatedAt: now, ...(setupCode ? { lastLogin: now } : { encryptedOnboardingPassword }),
    }
    const employee = employeeInput ? { isActive: true, status: 'active', employmentType: 'full-time', dateOfJoining: now, ...preparedEmployee, _id: employeeId, firstName: employeeInput.firstName.trim(), lastName: typeof employeeInput.lastName === 'string' ? employeeInput.lastName.trim() : '', employeeCode: employeeInput.employeeCode.trim(), email: normalizedEmail, phone: typeof employeeInput.phone === 'string' ? employeeInput.phone : '', userId, createdAt: now, updatedAt: now } : null
    if (employee) employee.searchGrams = employeeSearchGrams(employee)
    const mapping = { _id: mappingId, userId, email: normalizedEmail, tenantCompanyId: String(company._id), databaseName, companyName: company.name, companySlug: company.slug, role, isActive: true, loginCount: setupCode ? 1 : 0, createdAt: now, updatedAt: now }
    const updatedCompany = { ...company, subscription: { ...company.subscription, currentUserCount: activeUsers.size + 1 }, updatedAt: now, ...(setupCode || (superadmin && !company.isSetupComplete) ? { setupCode: { ...company.setupCode, isUsed: true, usedAt: now, usedByEmail: normalizedEmail }, isSetupComplete: true, setupCompletedAt: now } : {}) }
    // The same unique-key layout is used by the regular native repositories.
    const claims = [[databaseName, 'users', 'email', normalizedEmail, userId], [system, 'usertenantmappings', 'email', normalizedEmail, mappingId], ...(employee ? [[databaseName, 'employees', 'employeeCode', employee.employeeCode, employeeId], [databaseName, 'employees', 'email', normalizedEmail, employeeId]] : [])]
    const claimRefs = claims.map(([db, name, key, value]) => dbRoot(db).collection('uniqueKeys').doc(hash(JSON.stringify([name, [key], [value]]))))
    const claimSnapshots = await tx.getAll(...claimRefs)
    if (claimSnapshots.some(snapshot => snapshot.exists)) fail('Account or employee identity is already reserved', 409)
    function write(reference, record, create = true, previous = null) {
      const encoded = encodeApplicationRecord(record)
      if (create) tx.create(reference, encoded.envelope)
      else tx.set(reference, encoded.envelope)
      for (const part of encoded.parts) tx.set(reference.collection('parts').doc(part.id), part.value)
      for (const oldId of partIds(previous || {})) if (!encoded.parts.some(part => part.id === oldId)) tx.delete(reference.collection('parts').doc(oldId))
    }
    write(users.doc(userId), user)
    if (employee) write(collection(databaseName, 'employees').doc(employeeId), employee)
    write(mappings.doc(mappingId), mapping)
    write(companySnapshot.ref, updatedCompany, false, companySnapshot.data())
    if (candidate) {
      candidate = { ...candidate, convertedEmployeeId: employeeId, stage: 'hired', updatedAt: now, stageHistory: [...(candidate.stageHistory || []), { stage: 'hired', movedAt: now, movedBy: String(actor.employeeId?._id || actor.employeeId || actor._id), notes: `Converted to employee (${employee.employeeCode})` }] }
      write(candidateSnapshot.ref, candidate, false, candidateSnapshot.data())
    }
    if (setupCode && tokenId) write(collection(databaseName, 'usersessions').doc(sessionId), { _id: sessionId, user: userId, tokenId, isActive: true, authVersion: 0, loginAt: now, lastActivityAt: now, expiresAt: new Date(now.getTime() + 7 * 86400000), createdAt: now, updatedAt: now })
    claims.forEach(([, name, , , owner], index) => tx.create(claimRefs[index], { owner: `${name}/${owner}` }))
    return { user, employee, company: updatedCompany, tokenId, ...(candidate ? { candidate } : {}) }
  })
}

/** Platform-admin credential changes and registry state always commit together. */
export async function updateFirestoreAdminAccount(input, { superadmin, context } = {}) {
  if (!superadmin?._id || !superadmin.companyId) fail('Superadmin company context is required', 403)
  if (!input?.userId && typeof input?.email !== 'string') fail('Either userId or email is required')
  const updates = []
  let passwordHash
  if (input.password !== undefined) {
    if (typeof input.password !== 'string' || input.password.length < 8 || Buffer.byteLength(input.password) > 72) fail('Password must be 8 to 72 bytes long')
    passwordHash = await bcrypt.hash(input.password, 10)
    updates.push('forcePasswordChange')
  }
  for (const key of ['isActive', 'forcePasswordChange']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') fail(`${key} must be a boolean`)
    if (input[key] !== undefined && !updates.includes(key)) updates.push(key)
  }
  if (!updates.length) fail('No updates provided')
  const { firestore, dataset, catalog } = context || await getFirestoreProvisioningContext()
  const root = firestore.collection('talioDatasets').doc(dataset)
  const collection = (db, name) => root.collection('databases').doc(db).collection('collections').doc(name).collection('records')
  return firestore.runTransaction(async tx => {
    async function read(snapshot) {
      if (!snapshot.exists) return null
      const envelope = snapshot.data(), ids = partIds(envelope)
      const pieces = ids.length ? await tx.getAll(...ids.map(key => snapshot.ref.collection('parts').doc(key))) : []
      return decodeApplicationRecord(envelope, new Map(pieces.map(piece => [piece.id, piece.data()])))
    }
    const system = 'talio_superadmin'
    const admin = await read(await tx.get(collection(system, 'superadmins').doc(applicationRecordKey(String(superadmin._id)))))
    if (!admin?.isActive || admin.permissions?.canCreateCompanies !== true) fail('Superadmin account updates are not permitted', 403)
    const company = await read(await tx.get(collection(system, 'tenantcompanies').doc(applicationRecordKey(String(superadmin.companyId)))))
    if (!company?.isActive || !catalog.tenants?.some(row => row.tenantId === String(company._id) && row.databaseName === company.databaseName && row.active !== false)) fail('Company is inactive or unavailable', 403)
    const users = collection(company.databaseName, 'users')
    let userSnapshot
    if (input.userId) userSnapshot = await tx.get(users.doc(applicationRecordKey(String(input.userId))))
    else {
      const found = await tx.get(users.where(field('email'), '==', input.email.trim().toLowerCase()).limit(2))
      if (found.size !== 1) fail('Admin user not found', 404)
      userSnapshot = found.docs[0]
    }
    const user = await read(userSnapshot)
    if (!user || user.role !== 'admin') fail('Admin user not found', 404)
    const mappings = await tx.get(collection(system, 'usertenantmappings').where(field('email'), '==', user.email).limit(2))
    if (mappings.size !== 1) fail('User tenant mapping is missing or ambiguous', 409)
    const mappingSnapshot = mappings.docs[0], mapping = await read(mappingSnapshot)
    if (mapping.databaseName !== company.databaseName || String(mapping.tenantCompanyId) !== String(company._id) || String(mapping.userId) !== String(user._id)) fail('User tenant mapping does not match this company', 409)
    const now = new Date()
    const next = { ...user, updatedAt: now }
    if (passwordHash) Object.assign(next, { password: passwordHash, forcePasswordChange: true, passwordChangedAt: now, encryptedOnboardingPassword: null, currentPasswordResetId: null, resetPasswordToken: null, resetPasswordExpire: null, loginAttempts: 0, lockUntil: null })
    if (input.isActive !== undefined) next.isActive = input.isActive
    if (input.forcePasswordChange !== undefined) next.forcePasswordChange = input.forcePasswordChange
    if (passwordHash || (input.isActive === false && user.isActive !== false)) next.authVersion = (Number(user.authVersion) || 0) + 1
    function write(snapshot, record) {
      const encoded = encodeApplicationRecord(record)
      tx.set(snapshot.ref, encoded.envelope)
      for (const piece of encoded.parts) tx.set(snapshot.ref.collection('parts').doc(piece.id), piece.value)
      for (const key of partIds(snapshot.data())) if (!encoded.parts.some(piece => piece.id === key)) tx.delete(snapshot.ref.collection('parts').doc(key))
    }
    write(userSnapshot, next)
    if (input.isActive !== undefined) write(mappingSnapshot, { ...mapping, isActive: input.isActive, updatedAt: now })
    return { user: next, updates }
  })
}
