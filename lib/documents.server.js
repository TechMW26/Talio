import { randomBytes } from 'node:crypto'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

export const DOCUMENT_MANAGER_ROLES = ['admin', 'super_admin', 'hr']
export const DOCUMENT_STORE_OPTIONS = { queryFields: { documents: ['employee', 'category', 'fileId'], users: ['employeeId'], employees: ['userId'] } }
export const isDocumentId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
const fail = (message, status) => { throw Object.assign(new Error(message), { status }) }
const manager = user => DOCUMENT_MANAGER_ROLES.includes(user.role)
const employeeSummary = employee => employee ? Object.fromEntries(['_id', 'firstName', 'lastName', 'employeeCode', 'profilePicture'].filter(key => employee[key] !== undefined).map(key => [key, employee[key]])) : null

export async function getDocumentActor(database, user) {
  const account = await database.get('users', String(user._id || user.userId))
  return { employeeId: account?.employeeId || user.employeeId || null, canManage: manager(user) }
}

export function assertDocumentAccess(actor, document) {
  if (!actor.canManage && (!actor.employeeId || String(actor.employeeId) !== String(document.employee?._id || document.employee || ''))) fail('You do not have access to this document', 403)
}

export async function populateDocuments(database, records, knownEmployees) {
  const employees = knownEmployees || await readFirestoreReferences(database, 'employees', records.flatMap(record => [record.employee, record.uploadedBy]))
  return records.map(record => {
    // Binary letters and storage internals are delivered only by authorized file endpoints.
    const { generatedPdf, storage, ...publicRecord } = record
    return { ...publicRecord, employee: employeeSummary(employees.get(String(record.employee))), uploadedBy: employeeSummary(employees.get(String(record.uploadedBy))) }
  })
}

export async function listDocuments(database, user, { employeeId, category } = {}) {
  const actor = await getDocumentActor(database, user)
  if (employeeId && !isDocumentId(employeeId)) fail('Invalid employee id', 400)
  if (!actor.canManage && employeeId && String(actor.employeeId || '') !== employeeId) fail('Forbidden', 403)
  const scope = actor.canManage ? employeeId : actor.employeeId
  if (!actor.canManage && !scope) return []
  const filters = [...(scope ? [{ field: 'employee', operator: '==', value: String(scope) }] : []), ...(category ? [{ field: 'category', operator: '==', value: category }] : [])]
  const includeIdentity = !category || category === 'identity'
  // Both lists share an already-authorized tenant scope and can load together.
  const [documents, profiles] = await Promise.all([
    collectFirestorePages(database, 'documents', { filters }),
    includeIdentity ? collectFirestorePages(database, 'users', { filters: scope ? [{ field: 'employeeId', operator: '==', value: String(scope) }] : [] }) : [],
  ])
  const owners = await readFirestoreReferences(database, 'employees', [
    ...documents.flatMap(record => [record.employee, record.uploadedBy]),
    ...profiles.map(profile => profile.employeeId),
  ])
  const result = await populateDocuments(database, documents, owners)
  if (!category || category === 'identity') {
    // An HR-wide list explicitly reads the tenant's profiles. Personal lists
    // always use the same employee ownership restriction as document records.
    for (const profile of profiles) {
      const employee = employeeSummary(owners.get(String(profile.employeeId)))
      if (!employee) continue
      for (const side of ['Front', 'Back']) {
        const file = profile.profileCompletion?.[`aadhaar${side}`]
        if (!file?.url) continue
        result.push({ _id: `aadhaar-${side.toLowerCase()}-${profile.employeeId}`, name: `Aadhaar Card (${side})`, fileName: `Aadhaar Card (${side})`, category: 'identity', url: file.url, fileUrl: file.url, fileId: file.fileId, type: 'image', fileType: 'image', employee, uploadedBy: null, uploadedByLabel: 'Employee self-service', createdAt: file.uploadedAt || profile.profileCompletion.firstLoginAt, updatedAt: file.uploadedAt || profile.profileCompletion.firstLoginAt, isAadhaarDocument: true, isSystemGenerated: true })
      }
    }
  }
  return result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

function documentInput(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid document fields', 400)
  const output = Object.fromEntries(fields.filter(key => input[key] !== undefined).map(key => [key, input[key]]))
  for (const key of ['name', 'description', 'category', 'type', 'url', 'fileUrl', 'fileName', 'fileType', 'fileId', 'employee']) {
    if (output[key] !== undefined && output[key] !== null && typeof output[key] !== 'string') fail(`Invalid ${key}`, 400)
  }
  if (output.fileSize !== undefined && (!Number.isFinite(output.fileSize) || output.fileSize < 0)) fail('Invalid file size', 400)
  if (output.expiryDate) {
    output.expiryDate = new Date(output.expiryDate)
    if (!Number.isFinite(output.expiryDate.getTime())) fail('Invalid expiry date', 400)
  }
  return output
}

export async function createDocument(database, user, input) {
  const actor = await getDocumentActor(database, user)
  const data = documentInput(input, ['name', 'type', 'url', 'fileUrl', 'fileName', 'fileType', 'fileId', 'fileSize', 'category', 'employee', 'expiryDate'])
  if (data.fileUrl) data.url = data.fileUrl
  if (data.fileType) data.type = data.fileType
  if (data.fileName) data.name = data.fileName
  if (!data.name || !data.type || !data.url) fail('Document name, type, and url are required', 400)
  let employee = actor.employeeId ? await database.get('employees', String(actor.employeeId)) : null
  if (!employee) employee = (await database.list('employees', { filters: [{ field: 'userId', operator: '==', value: String(user._id || user.userId) }], limit: 1 })).records[0]
  if (!employee && !actor.canManage) fail('Uploader employee profile not found', 400)
  if (!actor.canManage) data.employee = employee._id
  if (data.employee && !isDocumentId(data.employee)) fail('Invalid employee id', 400)
  const now = new Date()
  const record = { ...data, _id: randomBytes(12).toString('hex'), uploadedBy: employee?._id || null, isCompanyDocument: actor.canManage && !data.employee, status: actor.canManage ? 'approved' : 'pending', isActive: true, createdAt: now, updatedAt: now }
  await database.transaction(async tx => {
    if (data.employee && !await tx.get('employees', data.employee)) fail('Employee not found', 404)
    await tx.create('documents', record)
  })
  return (await populateDocuments(database, [record]))[0]
}

export async function updateDocument(database, user, id, input, { remove = false } = {}) {
  if (!isDocumentId(id)) fail('Invalid document id', 400)
  const actor = await getDocumentActor(database, user)
  return database.transaction(async tx => {
    const existing = await tx.get('documents', id)
    if (!existing) fail('Document not found', 404)
    assertDocumentAccess(actor, existing)
    if (remove) {
      if (existing.generatedLetter && !actor.canManage) fail('Contact HR to remove an issued employment letter', 403)
      await tx.delete('documents', id)
      return existing
    }
    if (existing.generatedLetter) fail('Issued letters cannot be edited. Issue a revised letter from the employee profile.', 409)
    if (input.status && (!actor.canManage || existing.onboardingItemKey)) fail(existing.onboardingItemKey ? 'Review onboarding submissions from the employee lifecycle checklist' : 'Only HR can review documents', 403)
    const data = documentInput(input, ['name', 'description', 'category', 'expiryDate', ...(actor.canManage ? ['status'] : [])])
    if (data.status && !['approved', 'rejected'].includes(data.status)) fail('Invalid document status', 400)
    const next = { ...existing, ...data, updatedAt: new Date() }
    await tx.replace('documents', next)
    return next
  })
}
