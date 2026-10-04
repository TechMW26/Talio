'use strict'

const EMPLOYEE_SEARCH_FIELDS = ['firstName', 'lastName', 'email', 'employeeCode', 'designationLevelName']
const MAX_SEARCH_GRAMS = 1000
const SEARCH_GRAM_OVERFLOW_SENTINEL = '__talio_search_overflow_v1__'
function substringGrams(values) {
  const grams = new Set()
  for (const text of values) {
    const value = String(text || '').toLocaleLowerCase('en-US')
    for (let size = 1; size <= 3; size++) for (let index = 0; index <= value.length - size; index++) {
      grams.add(value.slice(index, index + size))
      // Keep this candidate index inline in Firestore. Overflow records join
      // the indexed candidate bucket; callers still apply exact text matching.
      if (grams.size > MAX_SEARCH_GRAMS) return [SEARCH_GRAM_OVERFLOW_SENTINEL]
    }
  }
  return [...grams].sort()
}
function employeeSearchGrams(employee) {
  return substringGrams(EMPLOYEE_SEARCH_FIELDS.map(field => employee[field]))
}
// Unlike legacy document sorting, Firestore excludes records whose ordered
// field is absent. Explicit nulls keep incomplete/imported records visible when
// users choose optional sort fields, without inventing dates or overwriting data.
function withSortFields(record, fields) {
  return { ...record, ...Object.fromEntries(fields.filter(field => record[field] === undefined).map(field => [field, null])) }
}
// Pure, named per-collection projections. No query interpretation or fallback
// scans. These additive fields never replace the original business fields.
function projectNativeRecord(collection, record) {
  if (collection === 'holidays') return { ...record, isActive: record.isActive ?? true }
  if (collection === 'announcements') return { ...record, status: record.status ?? (record.isActive === true ? 'published' : 'draft'), searchGrams: substringGrams([record.title, record.content]) }
  if (collection === 'jobpostings') return { ...withSortFields(record, ['createdAt', 'updatedAt', 'jobTitle', 'applicationDeadline']), searchGrams: substringGrams([record.jobTitle, record.jobCode, record.location]) }
  if (collection === 'candidates') return { ...withSortFields(record, ['createdAt', 'updatedAt', 'firstName', 'lastName', 'rating']), searchGrams: substringGrams([record.firstName, record.lastName, record.email, record.currentCompany, ...(record.skills || [])]) }
  if (collection === 'whiteboards') return { ...record, sharedUserIds: [...new Set((record.sharing || []).map(value => value?.userId).filter(Boolean).map(String))] }
  if (collection === 'onboardingemails') return { ...withSortFields(record, ['createdAt', 'recipientName', 'recipientEmail', 'employeeCode', 'sentAt', 'status']), queued: record.queued ?? false, searchGrams: substringGrams([record.recipientEmail, record.recipientName, record.employeeCode]) }
  if (collection === 'projectemailnotificationlogs') return { ...withSortFields(record, ['createdAt', 'recipientEmail', 'recipientName', 'sentAt', 'status']), searchGrams: substringGrams([record.recipientEmail, record.recipientName, record.subject]) }
  if (collection === 'employees') {
    const monthDay = value => value && !Number.isNaN(+new Date(value)) ? new Date(value).toISOString().slice(5, 10) : null
    return { ...record, birthdayMonthDay: monthDay(record.dateOfBirth), joiningMonthDay: monthDay(record.dateOfJoining), searchGrams: employeeSearchGrams(record), reviewIds: [...new Set((record.reviews || []).map(review => review?._id).filter(Boolean).map(String))] }
  }
  if (collection === 'suggestions') return { ...record, searchGrams: substringGrams([record.title, record.description, record.category]), isPublic: record.isPublic ?? true, isPinned: record.isPinned ?? false }
  if (collection === 'callalerts') return { ...record, receiverUserIds: [...new Set((record.receivers || []).map(receiver => receiver?.user).filter(Boolean).map(String))] }
  if (collection === 'performanceappraisals') return { ...record, approverUserIds: [...new Set((record.approvalSteps || []).flatMap(step => [step.approverUser, ...(step.approverUsers || [])]).filter(Boolean).map(String))] }
  if (collection === 'departments') return { ...record, searchGrams: substringGrams([record.name, record.code, record.description]) }
  if (collection === 'designations') return { ...record, searchGrams: substringGrams([record.title, record.levelName]) }
  if (collection === 'hrmsworkflows') return { ...record, confidential: record.confidential ?? false, searchGrams: substringGrams([record.title, record.caseNumber]) }
  if (collection === 'meetings') return { ...record, searchGrams: substringGrams([record.title]), inviteeEmployeeIds: [...new Set((record.invitees || []).map(value => value?.employee).filter(Boolean).map(String))], needsMeetingInsights: Boolean(record.transcript?.length || record.mom?.length || String(record.notes || '').trim()) && new Date(record.updatedAt || 0).getTime() > new Date(record.aiSummary?.sourceUpdatedAt || 0).getTime() }
  if (collection === 'projects') return { ...record, searchGrams: substringGrams([record.name]) }
  if (collection === 'tasks') return { ...record, searchGrams: substringGrams([record.title]) }
  if (collection === 'policies') return { ...record, applicableTo: record.applicableTo ?? 'all', searchGrams: substringGrams([record.title, record.description, record.category]) }
  if (collection === 'documents') return { ...record, searchGrams: substringGrams([record.name, record.title, record.description, record.fileName, record.category]) }
  if (collection === 'assets') return { ...record, assetCodeNormalized: String(record.assetCode || '').trim().toLowerCase(), searchGrams: substringGrams([record.name, record.assetCode, record.category, record.serialNumber]) }
  return record
}
module.exports = { EMPLOYEE_SEARCH_FIELDS, MAX_SEARCH_GRAMS, SEARCH_GRAM_OVERFLOW_SENTINEL, substringGrams, employeeSearchGrams, projectNativeRecord }
