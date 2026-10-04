import { createHash } from 'node:crypto'
import { getTenantBySlug } from '@/lib/tenantContext'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { readMachineToken, verifyMachineToken } from '@/lib/attendanceMachines/machineSecurity.server'

export const WP_MODELS = ['WordPressRecruitmentIntegration', 'JobPosting', 'Candidate', 'Department']
export const WP_ROLES = ['admin', 'hr', 'super_admin', 'superadmin']
export const syncError = (message, status = 400) => Object.assign(new Error(message), { status })
export const digest = value => createHash('sha256').update(value).digest('hex')
const objectId = value => /^[a-f0-9]{24}$/i.test(String(value || ''))
const stableId = value => digest(value).slice(0, 24)
const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const JOB_STATUSES = ['draft', 'open', 'on-hold', 'closed', 'cancelled']
const STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn']
export const WORDPRESS_COLLECTION = 'wordpressrecruitmentintegrations'
export function getWordpressStore(databaseName) {
  return getFirestoreTenantDatabase(databaseName, {
    queryFields: {
      jobpostings: ['updatedAt', '_id', 'wordpress.connectionId', 'wordpress.remoteId'],
      candidates: ['updatedAt', '_id', 'email', 'jobPosting', 'wordpress.connectionId', 'wordpress.remoteId'],
    },
    constraints: {
      jobpostings: [{ fields: ['jobCode'], sparse: true }],
      candidates: [{ fields: ['email', 'jobPosting'], sparse: true }],
    },
  })
}
async function findLinked(store, collection, id, connectionId, remoteId) {
  const direct = await store.get(collection, id)
  if (direct) return direct
  return (await store.list(collection, { filters: [{ field: 'wordpress.connectionId', operator: '==', value: connectionId }, { field: 'wordpress.remoteId', operator: '==', value: remoteId }], limit: 1 })).records[0] || null
}

export function normalizeSiteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw syncError('Enter a valid HTTPS WordPress URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw syncError('Use an HTTPS website URL without credentials, query or fragment')
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

export async function wordpressAuth(request, slug) {
  const tenant = /^[a-zA-Z0-9-]{1,100}$/.test(slug || '') ? await getTenantBySlug(slug) : null
  if (!tenant) throw syncError('Invalid connection', 401)
  const store = await getWordpressStore(tenant.databaseName)
  const integration = await store.get(WORDPRESS_COLLECTION, 'wordpress')
  if (!integration?.enabled || !verifyMachineToken(readMachineToken(request), integration.tokenHash)) throw syncError('Invalid or disabled connection', 401)
  if (request.headers.get('x-talio-site') !== integration.siteUrl) throw syncError('This connection belongs to a different WordPress site', 403)
  await store.mutate(WORDPRESS_COLLECTION, 'wordpress', current => ({ ...current, lastSeenAt: new Date() }))
  return { tenant, store, integration }
}

export function serializeJob(job) {
  return {
    id: String(job._id), externalId: job.wordpress?.remoteId || null, revision: job.updatedAt.toISOString(),
    title: job.jobTitle, description: job.jobDescription, status: job.status,
    location: job.location || '', employmentType: job.employmentType, workMode: job.workMode,
    requirements: job.requirements || [], responsibilities: job.responsibilities || [], benefits: job.benefits || [], skills: job.skills || [],
    deadline: job.applicationDeadline?.toISOString() || null,
    // Deliberately exclude internal recruiters, salary, notes and hiring decisions.
  }
}
export function serializeApplication(candidate) {
  return {
    id: String(candidate._id), externalId: candidate.wordpress?.remoteId || null, revision: candidate.updatedAt.toISOString(),
    jobId: String(candidate.jobPosting), fullName: [candidate.firstName, candidate.lastName].filter(Boolean).join(' '),
    email: candidate.email, phone: candidate.phone || '', coverLetter: candidate.coverLetter || '', stage: candidate.stage,
    appliedAt: (candidate.wordpress?.appliedAt || candidate.createdAt)?.toISOString?.() || candidate.createdAt.toISOString(),
    resume: candidate.resume?.url ? { name: candidate.resume.name || 'Resume', available: true } : null,
  }
}

export async function wordpressFeed(auth, { kind, cursor }) {
  if (!['jobs', 'applications'].includes(kind)) throw syncError('Invalid feed')
  let checkpoint
  if (cursor) {
    try { checkpoint = JSON.parse(Buffer.from(cursor, 'base64url').toString()) } catch { throw syncError('Invalid sync cursor') }
    if (!objectId(checkpoint.id) || !Number.isFinite(Date.parse(checkpoint.at))) throw syncError('Invalid sync cursor')
  }
  const store = await getWordpressStore(auth.tenant.databaseName)
  const collection = kind === 'jobs' ? 'jobpostings' : 'candidates'
  const orderBy = [{ field: 'updatedAt', direction: 'asc' }, { field: '_id', direction: 'asc' }]
  // Two disjoint indexed ranges preserve the durable timestamp/ID checkpoint,
  // including records sharing a timestamp and a deleted previous anchor.
  let records
  if (checkpoint) {
    const [tied, newer] = await Promise.all([
      store.list(collection, { filters: [{ field: 'updatedAt', operator: '==', value: new Date(checkpoint.at) }, { field: '_id', operator: '>', value: checkpoint.id }], orderBy, limit: 25 }),
      store.list(collection, { filters: [{ field: 'updatedAt', operator: '>', value: new Date(checkpoint.at) }], orderBy, limit: 25 }),
    ])
    records = [...tied.records, ...newer.records].slice(0, 25)
  } else records = (await store.list(collection, { orderBy, limit: 25 })).records
  const last = records.at(-1)
  return { records: records.map(kind === 'jobs' ? serializeJob : serializeApplication), cursor: last ? Buffer.from(JSON.stringify({ at: last.updatedAt.toISOString(), id: String(last._id) })).toString('base64url') : cursor || null, hasMore: records.length === 25 }
}

function validateExternalId(value) {
  if (!/^[1-9]\d{0,18}$/.test(String(value || ''))) throw syncError('Invalid WordPress record ID')
  return String(value)
}
function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw syncError('Invalid date')
  return date
}
async function saveInbound(store, collection, existing, id, fields, metadata, inputHash, baseRevision) {
  if (existing?.wordpress?.lastInboundHash === inputHash) return existing
  if (existing && (!baseRevision || existing.updatedAt.toISOString() !== baseRevision)) throw syncError('Both platforms changed this record. Review the conflict in WordPress before retrying.', 409)
  let saved
  try { saved = await store.transaction(async tx => {
    const current = await tx.get(collection, String(existing?._id || id))
    if (current?.wordpress?.lastInboundHash === inputHash) return current
    if ((existing && (!current || current.updatedAt.toISOString() !== existing.updatedAt.toISOString())) || (!existing && current)) throw syncError('Record changed during sync. Retry.', 409)
    const now = new Date()
    const defaults = collection === 'jobpostings' ? { employmentType: 'full-time', workMode: 'on-site', requirements: [], responsibilities: [], benefits: [], skills: [], status: 'draft' } : { stage: 'applied', source: 'website' }
    const next = { ...defaults, ...current, _id: String(existing?._id || id), createdAt: current?.createdAt || now, ...fields, wordpress: { ...current?.wordpress, ...metadata, lastInboundHash: inputHash }, updatedAt: now }
    if (current) await tx.replace(collection, next)
    else await tx.create(collection, next)
    return next
  }) }
  catch (error) { if (error.code === 'ALREADY_EXISTS') throw syncError('Record changed during sync. Retry.', 409); throw error }
  if (!saved) throw syncError('Record changed during sync. Retry.', 409)
  if (!existing && saved.wordpress?.lastInboundHash !== inputHash) throw syncError('Record changed during sync. Retry.', 409)
  return saved
}

export async function importWordpressJob(auth, input) {
  const store = await getWordpressStore(auth.tenant.databaseName)
  const remoteId = validateExternalId(input.externalId), connectionId = auth.integration.connectionId
  const id = stableId(`${connectionId}:job:${remoteId}`)
  const existing = input.id && objectId(input.id) ? await store.get('jobpostings', input.id)
    : await findLinked(store, 'jobpostings', id, connectionId, remoteId)
  if (input.id && !existing) throw syncError('Linked Talio job no longer exists. Review the connection.', 409)
  if (existing?.wordpress?.connectionId && (existing.wordpress.connectionId !== connectionId || existing.wordpress.remoteId !== remoteId)) throw syncError('Job is linked to another website record', 409)
  const fields = { jobTitle: text(input.title, 300), jobDescription: text(input.description, 100000), status: input.status,
    location: text(input.location), applicationDeadline: validDate(input.deadline) }
  if (!fields.jobTitle || !fields.jobDescription || !JOB_STATUSES.includes(fields.status)) throw syncError('Job title, description and valid status are required')
  if (['on-site', 'remote', 'hybrid'].includes(input.workMode)) fields.workMode = input.workMode
  if (['full-time', 'part-time', 'contract', 'internship', 'freelance'].includes(input.employmentType)) fields.employmentType = input.employmentType
  for (const key of ['requirements', 'responsibilities', 'benefits', 'skills']) if (Array.isArray(input[key])) fields[key] = input[key].slice(0, 100).map(value => text(value, 2000))
  const hash = digest(JSON.stringify(fields))
  if (!existing) { fields.department = auth.integration.defaultDepartment; fields.jobCode = `WP-${remoteId}-${connectionId.slice(0, 8)}` }
  const saved = await saveInbound(store, 'jobpostings', existing, id, fields, { connectionId, remoteId }, hash, input.baseRevision)
  return serializeJob(saved)
}

export async function importWordpressApplication(auth, input) {
  const store = await getWordpressStore(auth.tenant.databaseName)
  const remoteId = validateExternalId(input.externalId), connectionId = auth.integration.connectionId
  if (!objectId(input.jobId) || !await store.get('jobpostings', input.jobId)) throw syncError('Sync the job before its applications', 409)
  const email = text(input.email, 254).toLowerCase(), name = text(input.fullName, 300)
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw syncError('Applicant name and valid email are required')
  const id = stableId(`${connectionId}:application:${remoteId}`)
  let existing = input.id && objectId(input.id) ? await store.get('candidates', input.id)
    : await findLinked(store, 'candidates', id, connectionId, remoteId)
  if (input.id && !existing) throw syncError('Linked Talio application no longer exists. Review the connection.', 409)
  if (existing?.wordpress?.connectionId && (existing.wordpress.connectionId !== connectionId || existing.wordpress.remoteId !== remoteId)) throw syncError('Application is linked to another website record', 409)
  const words = name.split(/\s+/)
  const fields = { firstName: words.shift(), lastName: words.join(' '), email, phone: text(input.phone, 80), coverLetter: text(input.coverLetter, 30000), jobPosting: input.jobId }
  if (STAGES.includes(input.stage)) fields.stage = input.stage
  const hash = digest(JSON.stringify(fields))
  if (!existing) {
    // Match an existing Talio submission for the same job, never merge across jobs.
    const duplicate = (await store.list('candidates', { filters: [{ field: 'email', operator: '==', value: email }, { field: 'jobPosting', operator: '==', value: input.jobId }], limit: 1 })).records[0]
    if (duplicate) {
      if (duplicate.wordpress?.connectionId && (duplicate.wordpress.connectionId !== connectionId || duplicate.wordpress.remoteId !== remoteId)) throw syncError('This applicant already has a different website application for this job', 409)
      return serializeApplication(await store.mutate('candidates', duplicate._id, current => {
        if (current.wordpress?.connectionId && (current.wordpress.connectionId !== connectionId || current.wordpress.remoteId !== remoteId)) throw syncError('This applicant is linked to another website application', 409)
        return { ...current, wordpress: { ...current.wordpress, connectionId, remoteId, lastInboundHash: hash }, updatedAt: new Date() }
      }))
    }
    fields.source = 'website'; fields.stage = 'applied'
    fields.stageHistory = [{ stage: 'applied', movedAt: validDate(input.appliedAt) || new Date(), notes: 'Application received from WordPress' }]
  } else if (fields.stage && fields.stage !== existing.stage) {
    fields.stageHistory = [...(existing.stageHistory || []), { stage: fields.stage, movedAt: new Date(), notes: 'Stage updated from WordPress' }]
  }
  const saved = await saveInbound(store, 'candidates', existing, id, fields, { connectionId, remoteId, appliedAt: validDate(input.appliedAt) || existing?.createdAt || new Date(), resumePending: Boolean(input.hasResume) && !existing?.resume?.url }, hash, input.baseRevision)
  return serializeApplication(saved)
}
