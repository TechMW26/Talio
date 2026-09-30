import mongoose from 'mongoose'
import { failure, idOf, isHr } from './resignation.server'
import { applyLifecycleAction, hydrateEmployeeLifecycle, toIstDateKey } from './employeeLifecycle.server'
import { loadOffboardingAssetClearance } from './offboardingAssets.server'
import { validateSettlement } from './settlement'
import { employmentLetterDefaults } from './employmentLetter'
import { generateEmploymentLetterPdf, loadEmploymentLetterLogo } from './employmentLetterPdf.server'
import { sendEmail } from '@/lib/mailer'

export function startResignationExit(employee, record) {
  const current = hydrateEmployeeLifecycle(employee)
  if (idOf(current.offboarding?.resignationRequest) === idOf(record._id)) return current
  if (current.offboarding?.status && current.offboarding.status !== 'not_started') throw failure('An offboarding already exists for this employee. HR must reconcile it before continuing.', 409)
  const next = applyLifecycleAction(current, 'start_offboarding', { resignationDate: record.createdAt, lastWorkingDate: record.proposal.lastWorkingDate, reason: record.reason, separationType: 'resignation' }).lifecycle
  next.offboarding.resignationRequest = record._id
  return next
}

export async function acceptAndStartExit(models, current, input, update, event) {
  const session = await models.ResignationRequest.db.startSession()
  let record
  try {
    await session.withTransaction(async () => {
      const employee = await models.Employee.findById(current.employee).session(session).lean()
      if (!employee || ['resigned', 'terminated'].includes(employee.status)) throw failure('Active employment record required', 409)
      const lifecycle = startResignationExit(employee, current)
      record = await models.ResignationRequest.findOneAndUpdate({ _id: current._id, status: current.status, version: input.version }, { $set: update, $inc: { version: 1 }, $push: { timeline: event } }, { session, new: true, runValidators: true }).lean()
      if (!record) throw failure('Request changed. Refresh before accepting.', 409)
      await models.Employee.updateOne({ _id: employee._id }, { $set: { lifecycle, dateOfLeaving: current.proposal.lastWorkingDate }, $inc: { __v: 1 } }, { session, runValidators: true })
    })
    return record
  } finally { await session.endSession() }
}

export function assertExitReady(record, offboarding, input, now = new Date()) {
  if (record.status !== 'accepted') throw failure('Employee must accept the notice period before exit finalisation', 409)
  if (toIstDateKey(record.proposal.lastWorkingDate) > toIstDateKey(now)) throw failure('Finalise on or after the agreed last working date')
  if (!offboarding.assetsReturned) throw failure('Complete the asset-return checklist first')
  if (input.handoverConfirmed !== true || input.accessConfirmed !== true || input.settlementConfirmed !== true) throw failure('Confirm handover, access clearance and settlement recording')
  if (typeof input.paymentReference !== 'string' || input.paymentReference.trim().length < 3 || input.paymentReference.length > 200) throw failure('Enter the settlement payment/recovery reference, or a reason for a zero balance')
  if (!offboarding.settlement?.savedAt) throw failure('Save the full-and-final calculation first')
  const settlement = validateSettlement(offboarding.settlement)
  if (settlement.date > toIstDateKey(now) || settlement.date < toIstDateKey(record.proposal.lastWorkingDate)) throw failure('Settlement date must be between the last working date and today')
  return settlement
}

export function exitParagraphs({ employee, record, settlement, paymentReference, signer }) {
  return [
    { title: 'Separation confirmation', text: `This confirms that ${employee.firstName} ${employee.lastName} (${employee.employeeCode}) is relieved from employment following the accepted resignation. The agreed last working date is ${toIstDateKey(record.proposal.lastWorkingDate)}. HR has recorded completion of handover and asset/access clearance.` },
    { title: 'Full-and-final settlement statement', text: `Settlement date: ${settlement.date}\nCurrency: ${settlement.currency}\n${settlement.items.map(item => `${item.label} (${item.type}): ${item.amount.toFixed(2)}`).join('\n')}\nNet ${settlement.netAmount < 0 ? 'recovery from employee' : 'payable to employee'}: ${Math.abs(settlement.netAmount).toFixed(2)}` },
    { title: 'Settlement record', text: `HR-recorded payment/recovery reference: ${paymentReference}\nThis statement records the amounts and reference confirmed by HR. Talio does not transfer funds or independently verify bank settlement.${settlement.notes ? `\nNotes: ${settlement.notes}` : ''}` },
    { title: 'Issued by Human Resources', text: signer },
  ]
}

export async function finaliseExit(auth, actor, record, input) {
  if (!isHr(actor) || idOf(record.requestedBy) === idOf(actor._id)) throw failure('An independent HR/admin must finalise the exit', 403)
  const { models } = auth
  const employee = await models.Employee.findById(record.employee).lean()
  if (!employee) throw failure('Employee not found', 404)
  if (idOf(employee.lifecycle?.offboarding?.resignationRequest) !== idOf(record._id)) throw failure('Start the linked offboarding before finalising', 409)
  const clearance = await loadOffboardingAssetClearance({ Asset: models.Asset, employeeId: employee._id, offboarding: employee.lifecycle?.offboarding })
  let settlement
  try { settlement = assertExitReady(record, clearance.offboarding, input) } catch (error) { throw failure(error.message, error.status || 400) }
  const recipient = employee.email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || '')) throw failure('Correct the employee email address before finalising')
  const [company, settings, preferences, signer] = await Promise.all([
    employee.company ? models.Company.findById(employee.company).lean() : null,
    models.CompanySettings.findOne().lean(), models.SystemPreferences.findOne().lean(),
    actor.employeeId ? models.Employee.findById(actor.employeeId).lean() : null,
  ])
  const fields = employmentLetterDefaults({ employee, company: company || {}, settings: settings || {}, preferences: preferences || {}, signer: signer || {} })
  for (const key of ['companyName', 'companyAddress', 'employeeName', 'employeeCode', 'signatoryName']) if (!fields[key]) throw failure(`Complete ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} in company/employee records before issuing exit documents`)
  const logoSource = company?.logo || settings?.companyLogo || preferences?.companyLogo || preferences?.lightModeLogo
  let logo
  try { logo = await loadEmploymentLetterLogo(logoSource, auth.tenant.databaseName) } catch (error) { throw failure(error.message) }
  const reference = `EXIT/${fields.employeeCode}/${idOf(record._id)}`
  const bytes = generateEmploymentLetterPdf({ fields, logo, reference, title: 'RELIEVING & FINAL SETTLEMENT', paragraphs: exitParagraphs({ employee, record, settlement, paymentReference: input.paymentReference.trim(), signer: `${fields.signatoryName}\n${fields.companyName}` }) })
  const documentId = new mongoose.Types.ObjectId(idOf(record._id))
  const fileName = `exit-settlement-${fields.employeeCode.replace(/[^a-z0-9-]/gi, '-')}.pdf`
  const now = new Date()
  const session = await models.ResignationRequest.db.startSession()
  try {
    await session.withTransaction(async () => {
      const latest = await models.Employee.findById(employee._id).session(session).lean()
      if (Number(latest?.__v || 0) !== Number(employee.__v || 0)) throw failure('Employee clearance or settlement changed. Refresh before finalising.', 409)
      const changed = await models.ResignationRequest.updateOne({ _id: record._id, status: 'accepted', version: input.version }, { $set: { status: 'completed', active: false, completedAt: now, exitDocument: documentId }, $inc: { version: 1 }, $push: { timeline: { action: 'complete_exit', actor: actor._id, at: now, reason: 'HR finalised settlement, documents and separation' } } }, { session })
      if (changed.modifiedCount !== 1) throw failure('Request changed. Refresh before finalising.', 409)
      const offboarding = { ...clearance.offboarding, status: 'completed', completedAt: now, assetsReturned: true, accessRevoked: true, fullAndFinalStatus: 'completed', settlement: { ...settlement, savedAt: employee.lifecycle.offboarding.settlement.savedAt, confirmedAt: now, confirmedBy: actor._id, paymentReference: input.paymentReference.trim() } }
      await models.Employee.updateOne({ _id: employee._id }, { $set: { 'lifecycle.stage': 'alumni', 'lifecycle.offboarding': offboarding, status: 'resigned', dateOfLeaving: record.proposal.lastWorkingDate }, $inc: { __v: 1 } }, { session, runValidators: true })
      await models.User.updateMany({ employeeId: employee._id }, { $set: { isActive: false } }, { session })
      const accounts = await models.User.find({ employeeId: employee._id }).select('_id').session(session).lean()
      await models.UserSession.updateMany({ user: { $in: accounts.map(user => user._id) }, isActive: true }, { $set: { isActive: false, revokedAt: now, revokedReason: 'Employment exit finalised' } }, { session })
      await models.Document.create([{ _id: documentId, sourceKey: `resignation-exit:${record._id}`, employee: employee._id, uploadedBy: actor.employeeId || employee._id, name: fileName, fileName, type: 'application/pdf', fileType: 'application/pdf', url: `/api/documents/${documentId}/file`, fileUrl: `/api/documents/${documentId}/file`, fileSize: bytes.length, generatedPdf: bytes, category: 'exit', status: 'issued', isActive: true, emailDelivery: { status: 'not_sent', recipient }, generatedLetter: { kind: 'exit', reference, issuedBy: actor._id } }], { session })
    })
  } finally { await session.endSession() }
  return documentId
}

export async function emailExitDocument(models, documentId) {
  const doc = await models.Document.findOneAndUpdate({ _id: documentId, 'emailDelivery.status': { $in: ['not_sent', 'failed'] } }, { $set: { 'emailDelivery.status': 'sending', 'emailDelivery.startedAt': new Date() } }, { new: true }).select('+generatedPdf').lean()
  if (!doc) return (await models.Document.findById(documentId).select('emailDelivery').lean())?.emailDelivery
  let accepted = false
  try {
    const bytes = Buffer.isBuffer(doc.generatedPdf) ? doc.generatedPdf : Buffer.from(doc.generatedPdf.buffer)
    const result = await sendEmail({ to: doc.emailDelivery.recipient, subject: 'Your relieving and full-and-final settlement documents', text: 'Please find your relieving and full-and-final settlement documents attached. Please contact Human Resources if you have any questions.', html: '<p>Please find your relieving and full-and-final settlement documents attached. Please contact Human Resources if you have any questions.</p>', attachments: [{ filename: doc.fileName, content: bytes, contentType: 'application/pdf' }] })
    if (result.rejected?.length || (Array.isArray(result.accepted) && !result.accepted.length)) throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' })
    accepted = true
    await models.Document.updateOne({ _id: documentId }, { $set: { 'emailDelivery.status': 'sent', 'emailDelivery.sentAt': new Date(), 'emailDelivery.messageId': result.messageId || '' } })
    return { status: 'sent', recipient: doc.emailDelivery.recipient }
  } catch (error) {
    const definite = !accepted && (['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EDNS'].includes(error.code) || /not configured|transporter not initialized/i.test(error.message))
    const status = accepted ? 'sent' : definite ? 'failed' : 'unknown'
    await models.Document.updateOne({ _id: documentId }, { $set: { 'emailDelivery.status': status } }).catch(() => {})
    return { status, recipient: doc.emailDelivery.recipient }
  }
}
