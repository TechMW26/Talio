import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { getImage, getImageInfo } from '@/lib/gridfs'
import { getTenantBlob, buildTenantBlobPrefix, buildTenantRootPrefix } from '@/lib/platform/blobStorage.server'

export const INDUCTION_MODELS = ['InductionProgram', 'InductionProgress', 'Employee', 'User', 'Company']
export const canManageInduction = user => ['admin', 'hr', 'super_admin', 'superadmin'].includes(user?.role)
export const progressId = (employee, version) => createHash('sha256').update(`${employee}:${version}`).digest('hex')
export const inductionError = (message, status = 400) => Object.assign(new Error(message), { status })
const MAX_BYTES = 25 * 1024 * 1024

export async function resolveInductionProgram(models, company) {
  const companyId = company?._id || company
  const specific = companyId ? await models.InductionProgram.findById(`company:${companyId}`).lean() : null
  return specific || await models.InductionProgram.findById('organisation').lean()
}

export async function inductionScope(auth, companyId) {
  if (!companyId) return 'organisation'
  if (!/^[a-f0-9]{24}$/i.test(String(companyId)) || !await auth.models.Company.exists({ _id: companyId, isActive: true })) throw inductionError('Company not found in this organisation', 404)
  return `company:${String(companyId).toLowerCase()}`
}
const publicProgram = program => program ? { title: program.title, version: program.version, pageCount: program.pageCount, format: program.source.format, fileName: program.source.fileName, active: program.active, publishedAt: program.publishedAt, companyId: program.company ? String(program.company) : null } : null

export async function inductionSettings(auth, companyId = null) {
  if (!canManageInduction(auth.user)) throw inductionError('Only HR and administrators can manage induction content', 403)
  const scope = await inductionScope(auth, companyId)
  const [companies, programs] = await Promise.all([auth.models.Company.find({ isActive: true }).select('name code logo').sort({ name: 1 }).lean(), auth.models.InductionProgram.find({}).lean()])
  return { program: publicProgram(programs.find(item => item._id === scope)), companies: companies.map(company => ({ id: String(company._id), name: company.name, code: company.code, logo: company.logo, program: publicProgram(programs.find(item => item._id === `company:${company._id}`)) })), defaultProgram: publicProgram(programs.find(item => item._id === 'organisation')) }
}

export async function inspectInductionFile(bytes, filename) {
  if (!bytes?.length || bytes.length > MAX_BYTES) throw inductionError('Choose a presentation under 25 MB')
  const extension = String(filename).split('.').pop().toLowerCase()
  let pageCount
  if (extension === 'pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw inductionError('This file is not a valid PDF')
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    pageCount = pdf.getPageCount()
  } else if (extension === 'pptx') {
    const zip = await JSZip.loadAsync(bytes)
    const files = Object.values(zip.files)
    if (files.length > 4000 || files.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0) > 100 * 1024 * 1024) throw inductionError('This PowerPoint expands beyond the supported size. Export it as a PDF.')
    const presentation = zip.file('ppt/presentation.xml')
    if (!presentation) throw inductionError('This file is not a PowerPoint presentation')
    const xml = await presentation.async('string')
    pageCount = (xml.match(/<(?:\w+:)?sldId\s/g) || []).length
    if (pageCount !== files.filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file.name)).length) throw inductionError('The PowerPoint slide list is damaged. Export it again as PPTX or PDF.')
  } else throw inductionError('Use PDF or PowerPoint .pptx. Save legacy .ppt files as .pptx or PDF first.')
  if (!pageCount || pageCount > 100) throw inductionError('The presentation must contain between 1 and 100 pages')
  return { pageCount, format: extension }
}

export async function readInductionSource(auth, source, { publishing = false } = {}) {
  const fileId = String(source?.fileId || '')
  let bytes, fileSize
  if (/^[a-f\d]{24}$/i.test(fileId)) {
    const info = await getImageInfo(fileId)
    if (!info || info.metadata?.category !== 'documents') throw inductionError('Presentation upload was not found')
    if (publishing && String(info.metadata.userId) !== String(auth.user._id || auth.user.userId)) throw inductionError('Upload the presentation using your own account', 403)
    if (info.length > MAX_BYTES) throw inductionError('Presentation exceeds 25 MB')
    bytes = await getImage(fileId); fileSize = info.length
  } else {
    const prefix = publishing ? buildTenantBlobPrefix({ tenantId: auth.tenant.databaseName, ownerId: String(auth.user._id || auth.user.userId), category: 'documents' }) : buildTenantRootPrefix(auth.tenant.databaseName)
    if (!fileId.startsWith(`${prefix}/`) || fileId.includes('..')) throw inductionError('Presentation is outside the permitted storage', 403)
    const result = await getTenantBlob(fileId)
    if (!result?.stream || result.blob.size > MAX_BYTES) throw inductionError('Presentation is unavailable or exceeds 25 MB')
    bytes = Buffer.from(await new Response(result.stream).arrayBuffer()); fileSize = result.blob.size
  }
  if (!bytes?.length || bytes.length > MAX_BYTES) throw inductionError('Presentation is empty or too large')
  return { bytes, fileSize }
}

export async function publishInduction(auth, input) {
  if (!canManageInduction(auth.user)) throw inductionError('Only HR and administrators can publish induction content', 403)
  const scope = await inductionScope(auth, input.companyId)
  const title = String(input.title || '').trim()
  if (!title || title.length > 160) throw inductionError('Enter a presentation title (up to 160 characters)')
  if (input.previewConfirmed !== true) throw inductionError('Preview every page and confirm the presentation before publishing')
  const fileName = String(input.source?.fileName || '').slice(0, 255)
  const { bytes, fileSize } = await readInductionSource(auth, input.source, { publishing: true })
  const { pageCount, format } = await inspectInductionFile(bytes, fileName)
  const current = await auth.models.InductionProgram.findById(scope).lean()
  if ((current?.version || null) !== (input.previousVersion || null)) throw inductionError('The presentation changed. Reload Settings before publishing.', 409)
  const data = { company: input.companyId || null, title, version: randomUUID(), source: { fileId: String(input.source.fileId), fileName, fileSize, format }, pageCount, active: true, publishedBy: auth.user._id || auth.user.userId, publishedAt: new Date() }
  if (!current) {
    try { return await auth.models.InductionProgram.create({ _id: scope, ...data }) }
    catch (error) { if (error.code === 11000) throw inductionError('Another administrator published a presentation. Reload Settings.', 409); throw error }
  }
  const updated = await auth.models.InductionProgram.findOneAndUpdate({ _id: scope, version: current.version }, { $set: data }, { new: true })
  if (!updated) throw inductionError('The presentation changed. Reload Settings.', 409)
  return updated
}

export async function inductionStatus(auth) {
  const user = await auth.models.User.findById(auth.user._id || auth.user.userId).select('employeeId').lean()
  const employee = await (user?.employeeId
    ? auth.models.Employee.findById(user.employeeId)
    : auth.models.Employee.findOne({ userId: auth.user._id || auth.user.userId }))
    .select('_id company inductionCompletion').lean()
  // Resolve from the saved employee assignment, never a client-supplied company.
  const program = await resolveInductionProgram(auth.models, employee?.company)
  const progress = program && employee ? await auth.models.InductionProgress.findById(progressId(employee._id, program.version)).lean() : null
  return { program, employee, progress, canManage: canManageInduction(auth.user), required: Boolean(program?.active && employee && !progress?.acknowledgedAt) }
}

export function publicInductionStatus(status) {
  const { program, progress, required, canManage, employee } = status
  return { required, canManage, hasEmployee: Boolean(employee), program: publicProgram(program),
    viewedThrough: progress?.viewedThrough || 0, acknowledgedAt: progress?.acknowledgedAt || null }
}

export async function updateInductionProgress(auth, input) {
  const status = await inductionStatus(auth)
  const { employee, program } = status
  if (!employee) throw inductionError('An employee profile is required', 403)
  if (!program?.active || program.version !== input.version) throw inductionError('The induction presentation changed. Reload to continue.', 409)
  const _id = progressId(employee._id, program.version)
  try { await auth.models.InductionProgress.updateOne({ _id }, { $setOnInsert: { employee: employee._id, company: employee.company || null, programId: program._id, version: program.version, title: program.title, pageCount: program.pageCount, viewedThrough: 0 } }, { upsert: true }) }
  catch (error) { if (error.code !== 11000) throw error }
  if (input.action === 'page') {
    const page = Number(input.page)
    if (!Number.isInteger(page) || page < 1 || page > program.pageCount) throw inductionError('Invalid presentation page')
    const updated = await auth.models.InductionProgress.findOneAndUpdate({ _id, viewedThrough: { $gte: page - 1 } }, { $max: { viewedThrough: page } }, { new: true }).lean()
    if (!updated) throw inductionError('View the presentation in order before continuing', 409)
    return updated
  }
  if (input.action !== 'acknowledge' || input.acknowledged !== true) throw inductionError('Confirm that you have read and understood the presentation')
  const completed = await auth.models.InductionProgress.findOneAndUpdate({ _id, viewedThrough: program.pageCount, acknowledgedAt: null }, { $set: { acknowledgedAt: new Date(), acknowledgedBy: auth.user._id || auth.user.userId } }, { new: true }).lean()
    || await auth.models.InductionProgress.findOne({ _id, acknowledgedAt: { $ne: null } }).lean()
  if (!completed) throw inductionError('View every page before acknowledging', 409)
  // Store an independently auditable completion tag; manual induction checks do
  // not substitute for this employee acknowledgement.
  await auth.models.Employee.updateOne({ _id: employee._id }, { $set: { inductionCompletion: { version: program.version, title: program.title, acknowledgedAt: completed.acknowledgedAt } } })
  return completed
}
