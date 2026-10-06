import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

const id = value => String(value?._id || value || '')
export const getProfileStore = databaseName => getFirestoreTenantDatabase(databaseName, {
  queryFields: { employees: ['userId'] },
})

export async function getProfileRecords(store, userId) {
  const user = await store.get('users', id(userId))
  if (!user) return { user: null, employee: null }
  let employee = user.employeeId ? await store.get('employees', id(user.employeeId)) : null
  if (!employee) employee = (await store.list('employees', { filters: [{ field: 'userId', operator: '==', value: id(userId) }], limit: 1 })).records[0] || null
  return { user, employee }
}

const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields.split(' ')].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export async function populateProfileEmployee(store, employee) {
  if (!employee) return null
  const output = pick(employee, 'firstName lastName employeeCode email phone profilePicture bio designation designationLevel designationLevelName department departments reportingManager status dateOfJoining dateOfBirth gender address emergencyContact bloodGroup company aiGeneratedKRIs aiGeneratedKRIsMeta manualKRIs manualKPIs')
  for (const [field, collection, fields] of [
    ['designation', 'designations', 'title level levelName'], ['department', 'departments', 'name code'],
    ['reportingManager', 'employees', 'firstName lastName employeeCode'], ['company', 'companies', 'name logo'],
  ]) if (employee[field]) output[field] = pick(await store.get(collection, id(employee[field])), fields)
  output.departments = await Promise.all((employee.departments || []).map(async value => pick(await store.get('departments', id(value)), 'name code')))
  output.departments = output.departments.filter(Boolean)
  return output
}

export async function invalidateProfile(databaseName, userId) {
  await Promise.all(['profile*', 'dashboard:*'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: databaseName, userId: id(userId), namespace })))).catch(() => {})
}

export async function replaceProfilePicture(store, userId, employeeId, image) {
  return store.transaction(async tx => {
    const [user, employee] = await Promise.all([tx.get('users', id(userId)), tx.get('employees', id(employeeId))])
    if (!user || !employee || (id(user.employeeId) !== id(employeeId) && id(employee.userId) !== id(userId))) throw new Error('Employee profile link has changed')
    const previous = [...new Set([employee.profilePictureFileId, user.avatarFileId].filter(Boolean))]
    const nextEmployee = { ...employee, updatedAt: new Date() }
    const nextUser = { ...user, employeeId: id(employeeId), updatedAt: new Date() }
    if (image) {
      Object.assign(nextEmployee, { profilePicture: image.url, profilePictureFileId: id(image._id) })
      Object.assign(nextUser, { avatar: image.url, avatarFileId: id(image._id) })
    } else {
      delete nextEmployee.profilePicture; delete nextEmployee.profilePictureFileId
      delete nextUser.avatar; delete nextUser.avatarFileId
    }
    await tx.replace('employees', nextEmployee)
    await tx.replace('users', nextUser)
    return previous
  })
}

export async function replaceAadhaarImage(store, userId, side, image) {
  if (!['front', 'back'].includes(side)) throw new Error('Invalid Aadhaar side')
  let previous
  const user = await store.mutate('users', id(userId), current => {
    if (!current) throw new Error('User not found')
    const key = side === 'front' ? 'aadhaarFront' : 'aadhaarBack'
    previous = current.profileCompletion?.[key]?.fileId
    const profileCompletion = { ...current.profileCompletion, [key]: { url: image.url, fileId: id(image._id), uploadedAt: new Date() } }
    const both = Boolean(profileCompletion.aadhaarFront?.url && profileCompletion.aadhaarBack?.url)
    profileCompletion.completedFields = { ...profileCompletion.completedFields, aadhaarUploaded: both, ocrVerified: false }
    profileCompletion.ocrVerification = { status: 'pending' }
    profileCompletion.status = 'partially_complete'
    delete profileCompletion.completedAt
    return { ...current, profileCompletion, updatedAt: new Date() }
  })
  return { previous, bothUploaded: user.profileCompletion.completedFields.aadhaarUploaded }
}

export async function saveAadhaarVerification(store, originalUser, verification, { employeeId, address } = {}) {
  return store.transaction(async tx => {
    const current = await tx.get('users', id(originalUser._id))
    const employee = employeeId ? await tx.get('employees', id(employeeId)) : null
    for (const side of ['aadhaarFront', 'aadhaarBack']) {
      const before = originalUser.profileCompletion?.[side]
      const after = current?.profileCompletion?.[side]
      if (!after || before?.url !== after.url || before?.fileId !== after.fileId) throw Object.assign(new Error('Aadhaar images changed during verification. Please retry.'), { status: 409 })
    }
    const profileCompletion = { ...current.profileCompletion }
    const verified = verification.status === 'verified' || verification.status === 'matched'
    profileCompletion.ocrVerification = verification
    profileCompletion.completedFields = { ...profileCompletion.completedFields, ocrVerified: verified }
    profileCompletion.status = verified && profileCompletion.completedFields.personalInfo && profileCompletion.completedFields.aadhaarUploaded ? 'complete' : 'partially_complete'
    if (profileCompletion.status === 'complete') profileCompletion.completedAt = new Date()
    else delete profileCompletion.completedAt
    let addressAutoFilled = false
    if (employee && address && (!employee.address || (typeof employee.address === 'object' && !Object.values(employee.address).some(Boolean)))) {
      await tx.replace('employees', { ...employee, address: { fullAddress: address }, updatedAt: new Date() })
      addressAutoFilled = true
    }
    await tx.replace('users', { ...current, profileCompletion, updatedAt: new Date() })
    return { addressAutoFilled }
  })
}
