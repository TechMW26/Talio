import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { getTenantBySlug } from '@/lib/tenantContext'
import { getTenantModels } from '@/lib/tenantModels'
import { readMachineToken, verifyMachineToken } from '@/lib/attendanceMachines/machineSecurity.server'

export const WP_MODELS = ['WordPressRecruitmentIntegration', 'JobPosting', 'Candidate', 'Department']
export const WP_ROLES = ['admin', 'hr', 'super_admin', 'superadmin']
export const syncError = (message, status = 400) => Object.assign(new Error(message), { status })
export const digest = value => createHash('sha256').update(value).digest('hex')
const objectId = value => mongoose.Types.ObjectId.isValid(String(value || ''))
const stableId = value => new mongoose.Types.ObjectId(digest(value).slice(0, 24))
const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const JOB_STATUSES = ['draft', 'open', 'on-hold', 'closed', 'cancelled']
const STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn']

export function normalizeSiteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw syncError('Enter a valid HTTPS WordPress URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw syncError('Use an HTTPS website URL without credentials, query or fragment')
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

export async function wordpressAuth(request, slug) {
  const tenant = /^[a-zA-Z0-9-]{1,100}$/.test(slug || '') ? await getTenantBySlug(slug) : null
  if (!tenant) throw syncError('Invalid connection', 401)
  const models = await getTenantModels(tenant.databaseName, WP_MODELS)
  const integration = await models.WordPressRecruitmentIntegration.findById('wordpress').select('+tokenHash').lean()
  if (!integration?.enabled || !verifyMachineToken(readMachineToken(request), integration.tokenHash)) throw syncError('Invalid or disabled connection', 401)
  if (request.headers.get('x-talio-site') !== integration.siteUrl) throw syncError('This connection belongs to a different WordPress site', 403)
  await models.WordPressRecruitmentIntegration.updateOne({ _id: 'wordpress' }, { $set: { lastSeenAt: new Date() } })
  return { tenant, models, integration }
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
  const query = checkpoint ? { $or: [{ updatedAt: { $gt: new Date(checkpoint.at) } }, { updatedAt: new Date(checkpoint.at), _id: { $gt: new mongoose.Types.ObjectId(checkpoint.id) } }] } : {}
  const Model = kind === 'jobs' ? auth.models.JobPosting : auth.models.Candidate
  const records = await Model.find(query).sort({ updatedAt: 1, _id: 1 }).limit(25).lean()
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
async function saveInbound(Model, existing, id, fields, metadata, inputHash, baseRevision) {
  if (existing?.wordpress?.lastInboundHash === inputHash) return existing
  if (existing && (!baseRevision || existing.updatedAt.toISOString() !== baseRevision)) throw syncError('Both platforms changed this record. Review the conflict in WordPress before retrying.', 409)
  const filter = existing ? { _id: existing._id, updatedAt: existing.updatedAt } : { _id: id }
  const update = { [existing ? '$set' : '$setOnInsert']: { ...fields, wordpress: { ...existing?.wordpress, ...metadata, lastInboundHash: inputHash } } }
  let saved
  try { saved = await Model.findOneAndUpdate(filter, update, { new: true, upsert: !existing, setDefaultsOnInsert: true }).lean() }
  catch (error) { if (error.code === 11000) throw syncError('Record changed during sync. Retry.', 409); throw error }
  if (!saved) throw syncError('Record changed during sync. Retry.', 409)
  if (!existing && saved.wordpress?.lastInboundHash !== inputHash) throw syncError('Record changed during sync. Retry.', 409)
  return saved
}

export async function importWordpressJob(auth, input) {
  const remoteId = validateExternalId(input.externalId), connectionId = auth.integration.connectionId
  const id = stableId(`${connectionId}:job:${remoteId}`)
  const existing = input.id && objectId(input.id) ? await auth.models.JobPosting.findById(input.id).lean()
    : await auth.models.JobPosting.findOne({ $or: [{ _id: id }, { 'wordpress.connectionId': connectionId, 'wordpress.remoteId': remoteId }] }).lean()
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
  const saved = await saveInbound(auth.models.JobPosting, existing, id, fields, { connectionId, remoteId }, hash, input.baseRevision)
  return serializeJob(saved)
}

export async function importWordpressApplication(auth, input) {
  const remoteId = validateExternalId(input.externalId), connectionId = auth.integration.connectionId
  if (!objectId(input.jobId) || !await auth.models.JobPosting.exists({ _id: input.jobId })) throw syncError('Sync the job before its applications', 409)
  const email = text(input.email, 254).toLowerCase(), name = text(input.fullName, 300)
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw syncError('Applicant name and valid email are required')
  const id = stableId(`${connectionId}:application:${remoteId}`)
  let existing = input.id && objectId(input.id) ? await auth.models.Candidate.findById(input.id).lean()
    : await auth.models.Candidate.findOne({ $or: [{ _id: id }, { 'wordpress.connectionId': connectionId, 'wordpress.remoteId': remoteId }] }).lean()
  if (input.id && !existing) throw syncError('Linked Talio application no longer exists. Review the connection.', 409)
  if (existing?.wordpress?.connectionId && (existing.wordpress.connectionId !== connectionId || existing.wordpress.remoteId !== remoteId)) throw syncError('Application is linked to another website record', 409)
  const words = name.split(/\s+/)
  const fields = { firstName: words.shift(), lastName: words.join(' '), email, phone: text(input.phone, 80), coverLetter: text(input.coverLetter, 30000), jobPosting: new mongoose.Types.ObjectId(input.jobId) }
  if (STAGES.includes(input.stage)) fields.stage = input.stage
  const hash = digest(JSON.stringify(fields))
  if (!existing) {
    // Match an existing Talio submission for the same job, never merge across jobs.
    const duplicate = await auth.models.Candidate.findOne({ email, jobPosting: input.jobId }).lean()
    if (duplicate) {
      if (duplicate.wordpress?.connectionId && (duplicate.wordpress.connectionId !== connectionId || duplicate.wordpress.remoteId !== remoteId)) throw syncError('This applicant already has a different website application for this job', 409)
      return serializeApplication(await auth.models.Candidate.findByIdAndUpdate(duplicate._id, { $set: { wordpress: { ...duplicate.wordpress, connectionId, remoteId, lastInboundHash: hash } } }, { new: true }).lean())
    }
    fields.source = 'website'; fields.stage = 'applied'
    fields.stageHistory = [{ stage: 'applied', movedAt: validDate(input.appliedAt) || new Date(), notes: 'Application received from WordPress' }]
  } else if (fields.stage && fields.stage !== existing.stage) {
    fields.stageHistory = [...(existing.stageHistory || []), { stage: fields.stage, movedAt: new Date(), notes: 'Stage updated from WordPress' }]
  }
  const saved = await saveInbound(auth.models.Candidate, existing, id, fields, { connectionId, remoteId, appliedAt: validDate(input.appliedAt) || existing?.createdAt || new Date(), resumePending: Boolean(input.hasResume) && !existing?.resume?.url }, hash, input.baseRevision)
  return serializeApplication(saved)
}
