import { normalizeEmployeeAddress } from './employeeAddress'
import { normalizePhotoViewport } from './profilePhotoViewport'
import { buildEmployeeLifecycle } from './hrms/employeeLifecycle.server'
import { syncReportingManager } from './employeeReporting'
import { saveDesignation } from './designations.server'
import { inferLevelFromTitle, levelNameFromNumber, canHaveAssignedManager, canHaveAssignedTeamLead, requiresReportsTo, allowedReportsToLevels, DIRECTOR_LEVEL } from './designationLevels'

const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
const REF_FIELDS = ['company', 'department', 'designation', 'reportingManager', 'assignedManager', 'assignedTeamLead', 'reportsTo']
const TEXT_FIELDS = ['employeeCode', 'firstName', 'lastName', 'bio', 'email', 'phone', 'gender', 'maritalStatus', 'bloodGroup', 'designationLevelName', 'employmentType', 'workLocation', 'profilePicture', 'profilePictureFileId', 'status']
const ENUMS = { gender: ['male', 'female', 'other'], maritalStatus: ['single', 'married', 'divorced', 'widowed'], bloodGroup: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''], employmentType: ['full-time', 'part-time', 'contract', 'intern'], status: ['active', 'inactive', 'terminated', 'resigned', 'on_leave', 'probation'] }
const NESTED = {
  emergencyContact: { name: 'string', relationship: 'string', phone: 'string' },
  salary: Object.fromEntries(['basic', 'hra', 'conveyance', 'medical', 'special', 'allowances', 'deductions', 'grossSalary', 'ctc'].map(key => [key, 'number'])),
  pfEnrollment: { enrolled: 'boolean', pfNumber: 'string', uanNumber: 'string', enrollmentDate: 'date', employeeContribution: 'number', employerContribution: 'number' },
  esiEnrollment: { enrolled: 'boolean', esiNumber: 'string', enrollmentDate: 'date' },
  professionalTax: { applicable: 'boolean', amount: 'number' },
  tdsConfiguration: { enabled: 'boolean', percentage: 'number', fixedAmount: 'number' },
  healthInsurance: { enrolled: 'boolean', policyNumber: 'string', provider: 'string', enrollmentDate: 'date' },
  bankDetails: { accountNumber: 'string', bankName: 'string', ifscCode: 'string', branch: 'string' },
}
const ARRAYS = {
  qualifications: { degree: 'string', institution: 'string', year: 'number' },
  experience: { company: 'string', position: 'string', from: 'date', to: 'date', description: 'string' },
  documents: { name: 'string', type: 'string', url: 'string', fileId: 'string', uploadedAt: 'date' },
  manualKPIs: { name: 'string', target: 'string', unit: 'string', notes: 'string' },
}
const object = value => value && typeof value === 'object' && !Array.isArray(value)
function cast(value, type, name) {
  if (type === 'date') {
    if (value === '' || value === null) return null
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) fail(`Invalid ${name}`)
    return date
  }
  if (type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) fail(`Invalid ${name}`)
    return number
  }
  if (typeof value !== type) fail(`Invalid ${name}`)
  return type === 'string' ? value.trim() : value
}
function nested(value, fields, name) {
  if (!object(value)) fail(`Invalid ${name}`)
  return Object.fromEntries(Object.entries(fields).filter(([key]) => value[key] !== undefined).map(([key, type]) => [key, cast(value[key], type, `${name}.${key}`)]))
}

/** Explicit employee input schema replacing Mongoose casting/strict fields. */
export function normalizeEmployeeCreate(input, { deriveLifecycle = true } = {}) {
  if (!object(input)) fail('Employee details must be an object')
  const result = { status: 'active', employmentType: 'full-time', designationLevel: 1,
    pfEnrollment: { enrolled: false, employeeContribution: 12, employerContribution: 12 }, esiEnrollment: { enrolled: false },
    professionalTax: { applicable: false, amount: 0 }, tdsConfiguration: { enabled: false, percentage: 0, fixedAmount: 0 }, healthInsurance: { enrolled: false }, screenshotInterval: 240000,
  }
  for (const key of TEXT_FIELDS) if (input[key] !== undefined) result[key] = cast(input[key], 'string', key)
  if (input.profilePictureViewport !== undefined) {
    try { result.profilePictureViewport = normalizePhotoViewport(input.profilePictureViewport) } catch (error) { fail(error.message) }
  }
  for (const key of ['employeeCode', 'firstName', 'lastName', 'email']) if (!result[key]) fail(`${key} is required`)
  result.email = result.email.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) fail('Invalid employee email')
  if (result.bio?.length > 1000) fail('Bio must be at most 1000 characters')
  for (const [key, allowed] of Object.entries(ENUMS)) if (result[key] !== undefined && !allowed.includes(result[key])) fail(`Invalid ${key}`)
  for (const key of REF_FIELDS) if (input[key]) {
    if (typeof input[key] !== 'string' || !/^[a-f\d]{24}$/i.test(input[key])) fail(`Invalid ${key} ID`)
    result[key] = input[key]
  }
  if (input.departments !== undefined && (!Array.isArray(input.departments) || input.departments.length > 100)) fail('Invalid departments')
  result.departments = [...new Set((input.departments || []).filter(Boolean))]
  if (result.departments.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) fail('Invalid department ID')
  result.department ||= result.departments[0]
  if (result.department && !result.departments.includes(result.department)) result.departments.unshift(result.department)
  if (result.department === undefined) delete result.department
  for (const key of ['dateOfJoining', 'dateOfBirth', 'dateOfLeaving']) if (input[key] !== undefined) result[key] = cast(input[key], 'date', key)
  if (input.address !== undefined) result.address = normalizeEmployeeAddress(input.address)
  for (const [key, shape] of Object.entries(NESTED)) if (input[key] !== undefined) result[key] = { ...result[key], ...nested(input[key], shape, key) }
  for (const [key, shape] of Object.entries(ARRAYS)) if (input[key] !== undefined) {
    if (!Array.isArray(input[key]) || input[key].length > 100) fail(`Invalid ${key}`)
    result[key] = input[key].map(value => nested(value, shape, key))
  }
  for (const key of ['skills', 'manualKRIs']) if (input[key] !== undefined) {
    if (!Array.isArray(input[key]) || input[key].length > 100) fail(`Invalid ${key}`)
    result[key] = input[key].map(value => cast(value, 'string', key))
  }
  if (input.designationLevel !== undefined && input.designationLevel !== '') {
    result.designationLevel = Number(input.designationLevel)
    if (!Number.isInteger(result.designationLevel) || result.designationLevel < 1 || result.designationLevel > 9) fail('Invalid designation level')
  }
  if (input.screenshotInterval !== undefined) result.screenshotInterval = cast(input.screenshotInterval, 'number', 'screenshot interval')
  if (input.onboardingOwner && (typeof input.onboardingOwner !== 'string' || !/^[a-f\d]{24}$/i.test(input.onboardingOwner))) fail('Invalid onboarding owner')
  if (deriveLifecycle) {
    try { result.lifecycle = buildEmployeeLifecycle(input) } catch (error) { fail(error.message) }
    if (result.status === 'active' && result.lifecycle.stage !== 'preboarding' && result.lifecycle.probation.applicable) result.status = 'probation'
  }
  return result
}

export async function prepareEmployeeCreate(database, actor, input, { requireReporting = true } = {}) {
  if (!['admin', 'hr'].includes(actor.role)) throw Object.assign(new Error('Only administrators and HR can create employees'), { status: 403 })
  const result = normalizeEmployeeCreate(input)
  let designation = result.designation ? await database.get('designations', result.designation) : null
  if (result.designation && !designation) fail('Designation not found')
  const title = String(input.designationTitle || input.designationLevelName || '').trim()
  if (!designation && title) {
    const found = await database.list('designations', { filters: [{ field: 'title', operator: '==', value: title }], limit: 1 })
    designation = found.records[0]
    if (!designation) {
      try { designation = await saveDesignation(database, actor, { title, level: input.designationLevel || inferLevelFromTitle(title), levelName: input.designationLevelName }) }
      catch (error) {
        if (error.code !== 'ALREADY_EXISTS' && error.status !== 409) throw error
        designation = (await database.list('designations', { filters: [{ field: 'title', operator: '==', value: title }], limit: 1 })).records[0]
        if (!designation) throw error
      }
    }
  }
  if (designation) {
    result.designation = String(designation._id)
    result.designationLevel = Number(input.designationLevel || designation.level || 1)
    result.designationLevelName ||= designation.levelName || levelNameFromNumber(result.designationLevel)
  }
  for (const id of result.departments) if (!await database.get('departments', id)) fail('Department not found')
  if (result.company && !await database.get('companies', result.company)) fail('Company not found')
  if (result.lifecycle.onboarding.owner && !await database.get('employees', result.lifecycle.onboarding.owner)) fail('Onboarding owner not found')
  const level = result.designationLevel
  if (!canHaveAssignedManager(level) && result.assignedManager) fail('Director role cannot have an assigned manager')
  if (!canHaveAssignedTeamLead(level) && result.assignedTeamLead) fail('Only IC roles can have an assigned team lead')
  if (level === DIRECTOR_LEVEL && result.reportsTo) fail('Director role does not report to anyone')
  if (result.assignedManager && result.assignedManager === result.assignedTeamLead) fail('Assigned manager and team lead must be different')
  for (const key of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) if (result[key]) {
    const target = await database.get('employees', result[key])
    if (!target) fail(`Selected ${key} employee not found`)
    if (key === 'reportsTo' && !allowedReportsToLevels(level).has(Number(target.designationLevel) || inferLevelFromTitle(target.designationLevelName))) fail('Selected Reports To employee is outside the permitted hierarchy')
  }
  if (requireReporting && !result.reportsTo && requiresReportsTo(level)) {
    const found = await database.list('employees', { filters: [{ field: 'designationLevel', operator: 'in', value: [...allowedReportsToLevels(level)] }], limit: 1 })
    if (found.records.length) fail('Reports To is required; select an eligible executive')
  }
  syncReportingManager(result)
  return result
}

/** Validate only submitted fields; leave legacy optional field shapes intact. */
export async function prepareEmployeeUpdate(database, actor, current, input) {
  if (!object(input)) fail('Employee update must be an object')
  const manages = ['admin', 'hr'].includes(actor.role)
  const selfFields = new Set(['firstName', 'lastName', 'bio', 'phone', 'dateOfBirth', 'gender', 'maritalStatus', 'address', 'emergencyContact', 'bloodGroup', 'profilePicture', 'profilePictureFileId', 'profilePictureViewport', 'skills', 'qualifications', 'experience'])
  if (!manages && (String(actor.employeeId?._id || actor.employeeId) !== String(current._id) || Object.keys(input).some(key => !selfFields.has(key)))) throw Object.assign(new Error('Not permitted to edit these employee fields'), { status: 403 })
  const normalizedInput = { ...input }
  if (normalizedInput.level !== undefined) normalizedInput.designationLevel = normalizedInput.level
  const required = { firstName: current.firstName || '_', lastName: current.lastName || '_', email: current.email || 'legacy@example.invalid', employeeCode: current.employeeCode || '_', dateOfJoining: current.dateOfJoining }
  // Legacy records can lack a joining date. Do not manufacture a persisted date
  // just to edit their phone or department; this placeholder is validation-only.
  const parsed = normalizeEmployeeCreate({ ...required, dateOfJoining: required.dateOfJoining || '2000-01-01', ...normalizedInput }, { deriveLifecycle: false })
  const patch = Object.fromEntries(Object.keys(normalizedInput).filter(key => Object.hasOwn(parsed, key)).map(key => [key, parsed[key]]))
  delete patch.lifecycle
  for (const key of REF_FIELDS) if (Object.hasOwn(normalizedInput, key) && !normalizedInput[key]) patch[key] = null
  if (normalizedInput.departments !== undefined) { patch.departments = parsed.departments; patch.department = parsed.department || null }
  else if (normalizedInput.department !== undefined) patch.departments = parsed.departments
  const hierarchyKeys = ['designation', 'designationLevel', 'designationLevelName', 'designationTitle', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager', 'department', 'departments', 'company']
  if (hierarchyKeys.some(key => Object.hasOwn(normalizedInput, key))) {
    const candidate = { ...required, dateOfJoining: required.dateOfJoining || '2000-01-01', ...Object.fromEntries(hierarchyKeys.filter(key => current[key] !== undefined).map(key => [key, current[key]])), ...normalizedInput }
    if (!Object.hasOwn(normalizedInput, 'reportingManager') && ['assignedManager', 'assignedTeamLead', 'reportsTo'].some(key => Object.hasOwn(normalizedInput, key))) delete candidate.reportingManager
    if (Object.hasOwn(normalizedInput, 'designation') && !Object.hasOwn(normalizedInput, 'designationLevel')) delete candidate.designationLevel
    if (Object.hasOwn(normalizedInput, 'designation') && !Object.hasOwn(normalizedInput, 'designationLevelName')) delete candidate.designationLevelName
    const prepared = await prepareEmployeeCreate(database, actor, candidate, { requireReporting: false })
    if (!Object.hasOwn(normalizedInput, 'reportingManager') && ['assignedManager', 'assignedTeamLead', 'reportsTo'].some(key => Object.hasOwn(normalizedInput, key))) patch.reportingManager = prepared.reportingManager || null
    for (const key of ['designation', 'designationLevel', 'designationLevelName', 'reportingManager', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'department', 'departments', 'company']) {
      if (prepared[key] !== undefined && (Object.hasOwn(normalizedInput, key) || ['designation', 'designationLevel', 'designationLevelName', 'reportingManager'].includes(key))) patch[key] = prepared[key]
    }
  }
  for (const key of ['reportingManager', 'assignedManager', 'assignedTeamLead', 'reportsTo']) if (String(patch[key] || '') === String(current._id)) fail('Employee cannot report to themselves')
  if (!Object.keys(patch).length && !input.systemRole) fail('No supported employee fields supplied')
  return patch
}
