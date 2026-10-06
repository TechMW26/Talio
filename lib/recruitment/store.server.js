import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { CANDIDATE_SOURCE_VALUES } from '@/lib/recruitmentConstants'

export const RECRUITMENT_ROLES = ['admin', 'super_admin', 'hr', 'manager']
export const STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn']
export const JOB_STATUSES = ['draft', 'open', 'on-hold', 'closed', 'cancelled']
export const INTERVIEW_STATUSES = ['scheduled', 'in-progress', 'completed', 'cancelled', 'no-show', 'rescheduled']
export const RECRUITMENT_STORE_OPTIONS = {
  queryFields: {
    jobpostings: ['jobCode', 'status', 'department', 'employmentType', 'searchGrams', 'createdAt', 'updatedAt', 'jobTitle', 'applicationDeadline'],
    candidates: ['email', 'jobPosting', 'stage', 'source', 'offer.status', 'searchGrams', 'createdAt', 'updatedAt', 'firstName', 'lastName', 'rating'],
    interviews: ['candidate', 'jobPosting', 'status', 'interviewers', 'scheduledDate', 'round'],
  },
  constraints: { jobpostings: [{ fields: ['jobCode'], sparse: true }], candidates: [{ fields: ['email', 'jobPosting'], sparse: true }] },
}
export const recruitmentError = (message, status = 400) => Object.assign(new Error(message), { status })
export const refId = value => value?._id ? String(value._id) : value ? String(value) : null
export const employeeId = actor => refId(actor.employeeId) || refId(actor)
export const eq = (field, value, operator = '==') => ({ field, operator, value })
const newId = () => randomBytes(12).toString('hex')
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
const fail = (message, status) => { throw recruitmentError(message, status) }
export function recruitmentId(value) { if (!/^[a-f0-9]{24}$/i.test(String(value || ''))) fail('Invalid recruitment record ID'); return String(value) }
export function getRecruitmentDatabase(auth) { return getFirestoreTenantDatabase(auth.tenant.databaseName, RECRUITMENT_STORE_OPTIONS) }
function required(record, fields) { for (const field of fields) if (typeof record[field] !== 'string' || !record[field].trim()) fail(`${field} is required`) }
function enumeration(record, key, values) { if (!values.includes(record[key])) fail(`Invalid ${key}`) }
function date(value, field) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) fail(`Invalid ${field}`); return parsed }
function numeric(record, fields) { for (const [field, min, max = Infinity] of fields) if (record[field] != null && (!Number.isFinite(Number(record[field])) || Number(record[field]) < min || Number(record[field]) > max)) fail(`Invalid ${field}`); else if (record[field] != null) record[field] = Number(record[field]) }
const JOB_FIELDS = ['jobTitle', 'jobCode', 'department', 'designation', 'numberOfPositions', 'jobDescription', 'requirements', 'responsibilities', 'benefits', 'skills', 'educationLevel', 'experience', 'salaryRange', 'location', 'workMode', 'employmentType', 'status', 'applicationDeadline', 'hiringManager', 'recruiters', 'hiringPipeline', 'closedReason']
const CANDIDATE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'jobPosting', 'resume', 'coverLetter', 'currentCompany', 'currentDesignation', 'totalExperience', 'currentSalary', 'expectedSalary', 'noticePeriod', 'skills', 'education', 'source', 'sourceUrl', 'sourceMetadata', 'linkedinProfileUrl', 'linkedinPublicIdentifier', 'linkedinHeadline', 'linkedinCurrentCompany', 'linkedinCurrentPosition', 'linkedinSkills', 'linkedinImportedAt', 'referredBy', 'stage', 'rating', 'overallScore', 'offer', 'rejectionReason', 'tags']
const INTERVIEW_FIELDS = ['candidate', 'jobPosting', 'round', 'type', 'title', 'scheduledDate', 'duration', 'location', 'meetingLink', 'interviewers', 'status', 'cancelReason', 'notes']
async function requireReferences(tx, record, references) {
  for (const [field, collection] of references) for (const id of [record[field]].flat().filter(Boolean)) if (!await tx.get(collection, recruitmentId(refId(id)))) fail(`${field} reference not found`, 404)
}
function jobData(input, previous = {}) {
  const value = { numberOfPositions: 1, status: 'draft', educationLevel: 'any', workMode: 'on-site', employmentType: 'full-time', ...previous, ...pick(input, JOB_FIELDS) }
  required(value, ['jobTitle', 'jobDescription', 'department'])
  value.jobTitle = value.jobTitle.trim(); value.jobCode = value.jobCode?.trim()
  enumeration(value, 'status', JOB_STATUSES); enumeration(value, 'educationLevel', ['any', 'high-school', 'associate', 'bachelor', 'master', 'doctorate'])
  enumeration(value, 'workMode', ['on-site', 'remote', 'hybrid']); enumeration(value, 'employmentType', ['full-time', 'part-time', 'contract', 'internship', 'freelance'])
  numeric(value, [['numberOfPositions', 1]])
  if (!Number.isInteger(value.numberOfPositions)) fail('numberOfPositions must be an integer')
  if (value.applicationDeadline) value.applicationDeadline = date(value.applicationDeadline, 'applicationDeadline')
  if (value.status === 'open' && !value.publishedAt) value.publishedAt = new Date()
  if (value.status === 'closed' && !value.closedAt) value.closedAt = new Date()
  return value
}
function candidateData(input, previous = {}) {
  const value = { source: 'website', stage: 'applied', ...previous, ...pick(input, CANDIDATE_FIELDS) }
  required(value, ['firstName', 'lastName', 'email', 'jobPosting'])
  value.email = value.email.trim().toLowerCase(); value.firstName = value.firstName.trim(); value.lastName = value.lastName.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) fail('Invalid email')
  enumeration(value, 'source', CANDIDATE_SOURCE_VALUES); enumeration(value, 'stage', STAGES)
  numeric(value, [['totalExperience', 0], ['currentSalary', 0], ['expectedSalary', 0], ['noticePeriod', 0], ['rating', 0, 5], ['overallScore', 0, 100]])
  if (value.offer?.status) enumeration(value.offer, 'status', ['pending', 'accepted', 'rejected', 'withdrawn', 'negotiating'])
  return value
}
export async function saveJob(database, input, actor, id = null) {
  const recordId = id ? recruitmentId(id) : newId(), now = new Date()
  return database.transaction(async tx => {
    const previous = id ? await tx.get('jobpostings', recordId) : null
    if (id && !previous) fail('Job posting not found', 404)
    const record = jobData(input, previous || {})
    record.jobCode ||= `JOB-${recordId.toUpperCase()}`
    const duplicate = await tx.list('jobpostings', { filters: [eq('jobCode', record.jobCode)], limit: 2, requireComplete: true })
    if (duplicate.records.some(row => row._id !== recordId)) fail('Job code already exists', 409)
    await requireReferences(tx, record, [['department', 'departments'], ['designation', 'designations'], ['hiringManager', 'employees'], ['recruiters', 'employees']])
    const next = { ...record, _id: recordId, createdBy: previous?.createdBy || employeeId(actor), createdAt: previous?.createdAt || now, updatedAt: now }
    if (id) await tx.replace('jobpostings', next); else await tx.create('jobpostings', next)
    return next
  })
}
export async function saveCandidate(database, input, actor, id = null, applicationNote = 'Application submitted') {
  const recordId = id ? recruitmentId(id) : newId(), now = new Date()
  return database.transaction(async tx => {
    const previous = id ? await tx.get('candidates', recordId) : null
    if (id && !previous) fail('Candidate not found', 404)
    const record = candidateData(input, previous || {})
    const job = await tx.get('jobpostings', recruitmentId(record.jobPosting))
    if (!job) fail('Job posting not found', 404)
    if (!id && !['open', 'draft'].includes(job.status)) fail('Job posting is not accepting applications')
    const matches = await tx.list('candidates', { filters: [eq('email', record.email)], limit: 100, requireComplete: true })
    const duplicate = matches.records.find(row => row._id !== recordId)
    if (duplicate) return refId(duplicate.jobPosting) === record.jobPosting ? { existed: true, candidate: duplicate } : { crossJobDuplicate: true, existingCandidate: duplicate }
    await requireReferences(tx, record, [['referredBy', 'employees']])
    const next = { ...record, _id: recordId, createdBy: previous?.createdBy || employeeId(actor), createdAt: previous?.createdAt || now, updatedAt: now, stageHistory: [...(previous?.stageHistory || [])], notes: [...(previous?.notes || [])] }
    if (!previous) next.stage = 'applied'
    if (!previous || next.stage !== previous.stage) next.stageHistory.push({ stage: next.stage, movedAt: now, movedBy: employeeId(actor), notes: input.stageChangeNotes || input.stageNotes || (previous ? `Moved to ${next.stage}` : applicationNote) })
    const note = input.newNote || input.addNote
    if (note) { if (typeof note !== 'string') fail('Note must be text'); next.notes.push({ note, addedBy: employeeId(actor), addedAt: now }) }
    if (id) await tx.replace('candidates', next); else await tx.create('candidates', next)
    return { [id ? 'updated' : 'created']: true, candidate: next }
  })
}
export function canReadInterview(record, actor) { return RECRUITMENT_ROLES.includes(actor.role) || (record.interviewers || []).map(refId).includes(employeeId(actor)) }
export async function saveInterview(database, input, actor, id = null) {
  const recordId = id ? recruitmentId(id) : newId(), now = new Date(), isManager = RECRUITMENT_ROLES.includes(actor.role)
  return database.transaction(async tx => {
    const previous = id ? await tx.get('interviews', recordId) : null
    if (id && !previous) fail('Interview not found', 404)
    if (!isManager && (!previous || !canReadInterview(previous, actor) || !input.feedback || Object.keys(input).some(key => key !== 'feedback'))) fail('Insufficient permissions', 403)
    const record = { type: 'video', status: 'scheduled', duration: 60, ...previous, ...pick(input, INTERVIEW_FIELDS) }
    const candidate = await tx.get('candidates', recruitmentId(record.candidate))
    const job = await tx.get('jobpostings', recruitmentId(record.jobPosting))
    if (!candidate || !job || refId(candidate.jobPosting) !== record.jobPosting) fail('Candidate and job posting do not match', 400)
    if (!Array.isArray(record.interviewers) || !record.interviewers.length || record.interviewers.length > 30) fail('Provide 1 to 30 interviewers')
    record.interviewers = [...new Set(record.interviewers.map(refId))]
    await requireReferences(tx, record, [['interviewers', 'employees']])
    if (!record.round) {
      const rounds = await tx.list('interviews', { filters: [eq('candidate', record.candidate), eq('jobPosting', record.jobPosting)], limit: 100, requireComplete: true })
      record.round = Math.max(0, ...rounds.records.map(row => Number(row.round) || 0)) + 1
    }
    record.scheduledDate = date(record.scheduledDate, 'scheduledDate')
    numeric(record, [['round', 1], ['duration', 1]])
    enumeration(record, 'type', ['phone', 'video', 'in-person', 'technical', 'hr', 'panel', 'assignment']); enumeration(record, 'status', INTERVIEW_STATUSES)
    record.feedback = [...(previous?.feedback || [])]
    if (input.feedback) {
      const who = employeeId(actor)
      if (!record.interviewers.includes(who)) fail('Only assigned interviewers may submit feedback', 403)
      const entry = { ...pick(input.feedback, ['rating', 'strengths', 'weaknesses', 'comments', 'recommendation']), interviewer: who, submittedAt: now }
      numeric(entry, [['rating', 1, 5]])
      if (entry.recommendation) enumeration(entry, 'recommendation', ['strong-hire', 'hire', 'no-hire', 'strong-no-hire', 'undecided'])
      record.feedback = [...record.feedback.filter(row => refId(row.interviewer) !== who), entry]
      if (record.interviewers.every(key => record.feedback.some(row => refId(row.interviewer) === key))) record.status = 'completed'
    }
    const next = { ...record, _id: recordId, createdBy: previous?.createdBy || employeeId(actor), createdAt: previous?.createdAt || now, updatedAt: now }
    if (id) await tx.replace('interviews', next); else await tx.create('interviews', next)
    if (!id && ['applied', 'screening', 'shortlisted'].includes(candidate.stage)) await tx.replace('candidates', { ...candidate, stage: 'interview', updatedAt: now, stageHistory: [...(candidate.stageHistory || []), { stage: 'interview', movedAt: now, movedBy: employeeId(actor), notes: `Interview round ${record.round} scheduled` }] })
    return next
  })
}
/** Deletes are atomic and fail before writing when the set exceeds one transaction. */
export async function deleteRecruitmentRecord(database, collection, id) {
  recruitmentId(id)
  return database.transaction(async tx => {
    if (!await tx.get(collection, id)) fail('Record not found', 404)
    const candidates = collection === 'jobpostings' ? (await tx.list('candidates', { filters: [eq('jobPosting', id)], limit: 45, requireComplete: true })).records : []
    const interviews = collection !== 'interviews' ? (await tx.list('interviews', { filters: [eq(collection === 'jobpostings' ? 'jobPosting' : 'candidate', id)], limit: 45, requireComplete: true })).records : []
    if (candidates.length + interviews.length > 45) fail('This hiring record is too large to delete atomically; close or archive it instead', 409)
    for (const row of interviews) await tx.delete('interviews', row._id)
    for (const row of candidates) await tx.delete('candidates', row._id)
    await tx.delete(collection, id)
  })
}

export async function populateRecruitment(database, collection, records) {
  const employeeIds = [], jobIds = [], candidateIds = [], departmentIds = [], designationIds = []
  for (const row of records) {
    employeeIds.push(row.createdBy, row.hiringManager, row.referredBy, row.convertedEmployeeId, ...(row.recruiters || []), ...(row.interviewers || []), ...(row.notes instanceof Array ? row.notes.map(note => note.addedBy) : []), ...(row.stageHistory || []).map(stage => stage.movedBy), ...(row.feedback || []).map(feedback => feedback.interviewer))
    if (row.jobPosting) jobIds.push(row.jobPosting)
    if (row.candidate) candidateIds.push(row.candidate)
    if (row.department) departmentIds.push(row.department)
    if (row.designation) designationIds.push(row.designation)
  }
  const [employees, jobs, candidates, departments, designations] = await Promise.all([
    readFirestoreReferences(database, 'employees', employeeIds.map(refId)), readFirestoreReferences(database, 'jobpostings', jobIds.map(refId)), readFirestoreReferences(database, 'candidates', candidateIds.map(refId)), readFirestoreReferences(database, 'departments', departmentIds.map(refId)), readFirestoreReferences(database, 'designations', designationIds.map(refId)),
  ])
  const employee = id => id ? pick(employees.get(refId(id)), ['_id', 'firstName', 'lastName', 'email', 'employeeCode', 'profilePicture']) : null
  return records.map(row => ({
    ...row,
    ...(row.department ? { department: pick(departments.get(refId(row.department)), ['_id', 'name', 'code']) } : {}),
    ...(row.designation ? { designation: pick(designations.get(refId(row.designation)), ['_id', 'title']) } : {}),
    ...(row.jobPosting ? { jobPosting: pick(jobs.get(refId(row.jobPosting)), ['_id', 'jobTitle', 'jobCode', 'department', 'status', 'hiringManager']) } : {}),
    ...(row.candidate ? { candidate: pick(candidates.get(refId(row.candidate)), ['_id', 'firstName', 'lastName', 'email', 'phone', 'stage', 'resume', 'skills']) } : {}),
    ...Object.fromEntries(['createdBy', 'hiringManager', 'referredBy', 'convertedEmployeeId'].filter(key => row[key]).map(key => [key, employee(row[key])])),
    ...(row.recruiters ? { recruiters: row.recruiters.map(employee) } : {}), ...(row.interviewers ? { interviewers: row.interviewers.map(employee) } : {}),
    ...(Array.isArray(row.notes) ? { notes: row.notes.map(note => ({ ...note, addedBy: employee(note.addedBy) })) } : {}),
    ...(row.stageHistory ? { stageHistory: row.stageHistory.map(stage => ({ ...stage, movedBy: employee(stage.movedBy) })) } : {}),
    ...(row.feedback ? { feedback: row.feedback.map(feedback => ({ ...feedback, interviewer: employee(feedback.interviewer) })) } : {}),
  }))
}

export async function listRecruitment(database, collection, params, actor) {
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1), limit = Math.min(collection === 'jobpostings' ? 50 : 100, Math.max(1, Number.parseInt(params.get('limit') || '20', 10) || 20))
  if (page * limit > 10000) fail('Use a narrower filter for deep pagination')
  const fields = collection === 'jobpostings' ? ['status', 'department', 'employmentType'] : collection === 'candidates' ? ['jobPosting', 'stage', 'source'] : ['jobPosting', 'candidate', 'status']
  const filters = fields.filter(key => params.get(key)).map(key => eq(key, params.get(key)))
  let sort = collection === 'interviews' ? 'scheduledDate' : params.get('sortBy') || 'createdAt'
  const sortFields = collection === 'jobpostings' ? ['createdAt', 'updatedAt', 'jobTitle', 'applicationDeadline'] : collection === 'candidates' ? ['createdAt', 'updatedAt', 'firstName', 'lastName', 'rating'] : ['scheduledDate']
  if (!sortFields.includes(sort)) fail('Unsupported sort field')
  const direction = collection === 'interviews' || params.get('sortOrder') === 'asc' ? 'asc' : 'desc'
  if (collection === 'interviews') {
    const interviewer = RECRUITMENT_ROLES.includes(actor.role) ? params.get('interviewer') : employeeId(actor)
    if (interviewer) filters.push(eq('interviewers', interviewer, 'array-contains'))
    if (params.get('dateFrom')) filters.push(eq('scheduledDate', date(params.get('dateFrom'), 'dateFrom'), '>='))
    if (params.get('dateTo')) filters.push(eq('scheduledDate', date(params.get('dateTo'), 'dateTo'), '<='))
  }
  const search = (params.get('search') || '').trim().toLowerCase()
  let records, total
  if (search && collection !== 'interviews') {
    filters.push(eq('searchGrams', search.slice(0, 3), 'array-contains'))
    // The explicit search index narrows candidates first; sorting the bounded
    // exact-match set avoids a search-gram index for every display sort option.
    const matches = await collectFirestorePages(database, collection, { filters })
    const searchValues = row => collection === 'jobpostings' ? [row.jobTitle, row.jobCode, row.location] : [row.firstName, row.lastName, row.email, row.currentCompany, ...(row.skills || [])]
    const exact = matches.filter(row => searchValues(row).some(value => String(value || '').toLowerCase().includes(search))).sort((a, b) => {
      const left = a[sort] instanceof Date ? a[sort].getTime() : a[sort] ?? '', right = b[sort] instanceof Date ? b[sort].getTime() : b[sort] ?? ''
      const comparison = typeof left === 'string' ? left.localeCompare(String(right)) : left < right ? -1 : left > right ? 1 : 0
      return (direction === 'asc' ? comparison : -comparison) || String(a._id).localeCompare(String(b._id))
    })
    total = exact.length; records = exact.slice((page - 1) * limit, page * limit)
  } else {
    total = await database.count(collection, filters)
    let cursor = null
    for (let index = 1; index <= page; index++) {
      const result = await database.list(collection, { filters, orderBy: [{ field: sort, direction }], limit, cursor })
      records = index === page ? result.records : []; cursor = result.nextCursor
      if (!cursor) break
    }
  }
  const data = await populateRecruitment(database, collection, records || [])
  if (collection === 'jobpostings') await Promise.all(data.map(async row => { row.candidateCount = await database.count('candidates', [eq('jobPosting', row._id)]) }))
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } }
}
