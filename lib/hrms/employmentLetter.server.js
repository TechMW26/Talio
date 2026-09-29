import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { employmentLetterDefaults, validateEmploymentLetter } from './employmentLetter'
import { generateEmploymentLetterPdf, loadEmploymentLetterLogo } from './employmentLetterPdf.server'
import { sendEmail } from '@/lib/mailer'

export async function loadEmploymentLetterContext(auth, employeeId) {
  const { Employee, Company, CompanySettings, SystemPreferences, Policy, User } = auth.models
  const employee = await Employee.findById(employeeId).populate('designation', 'title name').populate('department', 'name')
    .populate('reportingManager assignedManager reportsTo', 'firstName lastName').lean()
  if (!employee) { const error = new Error('Employee not found'); error.status = 404; throw error }
  const actor = await User.findById(auth.user._id || auth.user.userId).select('employeeId').lean()
  const [company, settings, preferences, signer, policies] = await Promise.all([
    employee.company ? Company.findById(employee.company).lean() : null,
    CompanySettings.findOne().lean(), SystemPreferences.findOne().lean(),
    actor?.employeeId ? Employee.findById(actor.employeeId).populate('designation', 'title name').lean() : null,
    Policy.find({ isActive: { $ne: false }, $or: [{ applicableTo: 'all' }, { applicableTo: { $exists: false } }, { specificEmployees: employee._id }, ...(employee.department?._id ? [{ department: employee.department._id }] : [])] }).select('title name').lean(),
  ])
  const defaults = employmentLetterDefaults({ employee, company: company || {}, settings: settings || {}, preferences: preferences || {}, signer: signer || {}, policies })
  const logo = company?.logo || settings?.companyLogo || preferences?.companyLogo || preferences?.lightModeLogo || ''
  return { employee, defaults, logo, actorEmployeeId: actor?.employeeId }
}

export async function issueEmploymentLetter(auth, context, payload) {
  const fields = validateEmploymentLetter(payload.kind, payload.fields)
  const logo = await loadEmploymentLetterLogo(context.logo, auth.tenant.databaseName)
  const { Document } = auth.models
  const sourceKey = createHash('sha256').update(JSON.stringify({ employee: String(context.employee._id), kind: payload.kind, fields, logo: logo.data })).digest('hex')
  let document = await Document.findOne({ sourceKey, isActive: { $ne: false } }).select('+generatedPdf')
  if (!document) {
    // Production disables automatic secondary-index creation. A deterministic
    // primary key also prevents duplicate issues before that index is deployed.
    const id = new mongoose.Types.ObjectId(sourceKey.slice(0, 24))
    const reference = `HR/${fields.employeeCode}/${fields.issueDate.replaceAll('-', '')}/${sourceKey.slice(0, 8).toUpperCase()}`
    const fileName = `${payload.kind}-letter-${fields.employeeCode.replace(/[^a-z0-9-]/gi, '-')}-${fields.issueDate}.pdf`
    const bytes = generateEmploymentLetterPdf({ kind: payload.kind, fields, logo, reference })
    const url = `/api/documents/${id}/file`
    try {
      document = await Document.create({ _id: id, sourceKey, name: fileName, fileName, type: 'application/pdf', fileType: 'application/pdf',
        url, fileUrl: url, fileSize: bytes.length, generatedPdf: bytes, employee: context.employee._id, uploadedBy: context.actorEmployeeId,
        category: 'employment', status: 'issued', isActive: true, generatedLetter: { kind: payload.kind, fields, reference, issuedBy: auth.user._id || auth.user.userId },
        emailDelivery: { status: 'not_sent' },
      })
    } catch (error) {
      if (error.code !== 11000) throw error
      document = await Document.findOne({ sourceKey }).select('+generatedPdf')
      if (!document) throw error
    }
  }
  let emailError = null
  if (payload.sendEmail) {
    const recipient = context.employee.email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || '')) throw new Error('Update the employee email address before sending the letter')
    const claimed = await Document.findOneAndUpdate({ _id: document._id, 'emailDelivery.status': { $in: ['not_sent', 'failed'] } }, {
      $set: { emailDelivery: { status: 'sending', recipient, startedAt: new Date() } },
    }, { new: true })
    if (claimed) {
      let accepted = false
      try {
        const title = payload.kind === 'offer' ? 'Offer of employment' : 'Appointment letter'
        const message = `Dear ${fields.employeeName},\n\nPlease find your ${title.toLowerCase()} from ${fields.companyName} attached. Please review and return your signed acceptance to Human Resources.\n\n${fields.signatoryName}\n${fields.signatoryTitle}\n${fields.companyName}`
        const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
        const result = await sendEmail({ to: recipient, subject: `${title} - ${fields.companyName} - ${fields.employeeName}`, text: message,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-line">${escape(message)}</div>`,
          attachments: [{ filename: document.fileName, content: Buffer.from(document.generatedPdf), contentType: 'application/pdf' }],
        })
        if (result.rejected?.length || (Array.isArray(result.accepted) && !result.accepted.length)) {
          const error = new Error('The mail server rejected the recipient'); error.code = 'EENVELOPE'; throw error
        }
        accepted = true
        await Document.updateOne({ _id: document._id }, { $set: { 'emailDelivery.status': 'sent', 'emailDelivery.sentAt': new Date(), 'emailDelivery.messageId': result.messageId || '' } })
        document.emailDelivery = { status: 'sent', recipient }
      } catch (error) {
        // Never retry an ambiguous SMTP outcome automatically: the recipient may
        // already have received the message, even when acknowledgement was lost.
        const definitelyFailed = !accepted && (['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EDNS'].includes(error.code) || /not configured|transporter not initialized|missing.*(?:email|smtp)|email.*configuration/i.test(error.message))
        const status = accepted ? 'sent' : definitelyFailed ? 'failed' : 'unknown'
        emailError = accepted
          ? 'The mail server accepted the letter, but its delivery status could not be saved. Check with HR before sending again.'
          : definitelyFailed
            ? 'The PDF is saved in employee documents, but email delivery failed. Check the email configuration or recipient and retry.'
            : 'The PDF is saved, but the mail server did not confirm delivery. Check with HR before sending again to avoid duplicate emails.'
        await Document.updateOne({ _id: document._id }, { $set: { 'emailDelivery.status': status } }).catch(() => {})
        document.emailDelivery = { status, recipient }
      }
    } else {
      document = await Document.findById(document._id).select('+generatedPdf')
      if (document.emailDelivery?.status === 'sending') emailError = 'The letter is saved. Email delivery is already in progress; check its status before retrying.'
      if (document.emailDelivery?.status === 'unknown') emailError = 'Email delivery is unconfirmed. Check with HR before sending again to avoid duplicate emails.'
    }
  }
  return { document: { _id: document._id, name: document.name, fileName: document.fileName, fileUrl: document.fileUrl, fileType: document.fileType, emailDelivery: document.emailDelivery }, emailError }
}
