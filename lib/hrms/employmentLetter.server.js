import { createHash } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob, buildAuthenticatedBlobUrl, buildTenantBlobPrefix } from '@/lib/platform/blobStorage.server'
import { employmentLetterDefaults, validateEmploymentLetter } from './employmentLetter'
import { generateEmploymentLetterPdf, loadEmploymentLetterLogo } from './employmentLetterPdf.server'
import { sendEmail } from '@/lib/mailer'

export function getEmploymentLetterDatabase(auth) {
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: { documents: ['sourceKey', 'employee', 'generatedLetter.kind', 'createdAt'], policies: ['applicableTo', 'specificEmployees', 'department'] },
    constraints: { documents: [{ fields: ['sourceKey'], sparse: true }] },
  })
}

async function documentBytes(database, document) {
  if (!document.storage?.pathname) {
    if (!document.generatedPdf) throw new Error('Document is unavailable')
    return Buffer.isBuffer(document.generatedPdf) ? document.generatedPdf : Buffer.from(document.generatedPdf.buffer)
  }
  const prefix = `${buildTenantBlobPrefix({ tenantId: database.databaseName, category: 'documents', ownerId: String(document.generatedLetter?.issuedBy) })}/`
  if (document.storage.access !== 'private' || !document.storage.pathname.startsWith(prefix) || document.storage.pathname.includes('..')) throw new Error('Document belongs to another tenant or owner')
  const result = await getTenantBlob(document.storage.pathname, { access: 'private' })
  if (result?.statusCode !== 200 || !result.stream) throw new Error('Document is unavailable')
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
  if (bytes.length !== document.fileSize || createHash('sha256').update(bytes).digest('hex') !== document.storage.sha256) throw new Error('Document checksum mismatch')
  return bytes
}

export async function loadEmploymentLetterContext(auth, employeeId) {
  const database = auth.database || await getEmploymentLetterDatabase(auth)
  const employee = await database.get('employees', employeeId)
  if (!employee) { const error = new Error('Employee not found'); error.status = 404; throw error }
  const actor = await database.get('users', String(auth.user._id || auth.user.id || auth.user.userId))
  const scopes = [[{ field: 'applicableTo', operator: '==', value: 'all' }], [{ field: 'specificEmployees', operator: 'array-contains', value: employeeId }], ...(employee.department ? [[{ field: 'department', operator: '==', value: String(employee.department) }]] : [])]
  const [company, settingsPage, preferencesPage, signer, policyGroups] = await Promise.all([
    employee.company ? database.get('companies', String(employee.company)) : null,
    database.list('companysettings', { limit: 1 }), database.list('systempreferences', { limit: 1 }),
    actor?.employeeId ? database.get('employees', String(actor.employeeId)) : null,
    Promise.all(scopes.map(filters => collectFirestorePages(database, 'policies', { filters }))),
  ])
  const settings = settingsPage.records[0], preferences = preferencesPage.records[0]
  const policies = [...new Map(policyGroups.flat().filter(policy => policy.isActive !== false).map(policy => [policy._id, policy])).values()]
  for (const field of ['reportingManager', 'assignedManager', 'reportsTo']) if (employee[field]) employee[field] = await database.get('employees', String(employee[field]))
  if (employee.department) employee.department = await database.get('departments', String(employee.department))
  if (employee.designation) employee.designation = await database.get('designations', String(employee.designation))
  if (signer?.designation) signer.designation = await database.get('designations', String(signer.designation))
  const defaults = employmentLetterDefaults({ employee, company: company || {}, settings: settings || {}, preferences: preferences || {}, signer: signer || {}, policies })
  const logo = company?.logo || settings?.companyLogo || preferences?.companyLogo || preferences?.lightModeLogo || ''
  return { employee, defaults, logo, actorEmployeeId: actor?.employeeId }
}

export async function issueEmploymentLetter(auth, context, payload) {
  const fields = validateEmploymentLetter(payload.kind, payload.fields)
  const logo = await loadEmploymentLetterLogo(context.logo, auth.tenant.databaseName)
  const database = auth.database || await getEmploymentLetterDatabase(auth)
  const sourceKey = createHash('sha256').update(JSON.stringify({ employee: String(context.employee._id), kind: payload.kind, fields, logo: logo.data })).digest('hex')
  let document = (await database.list('documents', { filters: [{ field: 'sourceKey', operator: '==', value: sourceKey }], limit: 1 })).records[0]
  if (document?.isActive === false) throw new Error('This issued letter was deactivated; change the issue details before reissuing')
  if (!document) {
    // Production disables automatic secondary-index creation. A deterministic
    // primary key also prevents duplicate issues before that index is deployed.
    const id = sourceKey.slice(0, 24)
    const reference = `HR/${fields.employeeCode}/${fields.issueDate.replaceAll('-', '')}/${sourceKey.slice(0, 8).toUpperCase()}`
    const fileName = `${payload.kind}-letter-${fields.employeeCode.replace(/[^a-z0-9-]/gi, '-')}-${fields.issueDate}.pdf`
    const bytes = generateEmploymentLetterPdf({ kind: payload.kind, fields, logo, reference })
    const ownerId = String(auth.user._id || auth.user.id || auth.user.userId)
    const storage = await uploadTenantBlob({ tenantId: auth.tenant.databaseName, category: 'documents', ownerId, filename: fileName, body: bytes, contentType: 'application/pdf', access: 'private' })
    storage.sha256 = createHash('sha256').update(bytes).digest('hex')
    const url = buildAuthenticatedBlobUrl(storage.pathname)
    let retained = false
    try {
      document = await database.transaction(async tx => {
        const existing = await tx.get('documents', id)
        if (existing) {
          if (existing.sourceKey !== sourceKey || existing.isActive === false) throw new Error('Document identifier already exists')
          return existing
        }
        const record = { _id: id, sourceKey, name: fileName, fileName, type: 'application/pdf', fileType: 'application/pdf',
          url, fileUrl: url, fileId: storage.pathname, fileSize: bytes.length, storage, employee: context.employee._id, uploadedBy: context.actorEmployeeId || context.employee._id,
          category: 'employment', status: 'issued', isActive: true, generatedLetter: { kind: payload.kind, fields, reference, issuedBy: ownerId },
          emailDelivery: { status: 'not_sent' }, createdAt: new Date(), updatedAt: new Date(),
        }
        await tx.create('documents', record)
        return record
      })
      retained = document.storage?.pathname === storage.pathname
    } finally {
      if (!retained) await deleteTenantBlob(storage.pathname).catch(() => {})
    }
  }
  let emailError = null
  if (payload.sendEmail) {
    const recipient = context.employee.email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || '')) throw new Error('Update the employee email address before sending the letter')
    const claimed = await database.transaction(async tx => {
      const current = await tx.get('documents', document._id)
      if (!current || !['not_sent', 'failed'].includes(current.emailDelivery?.status)) return null
      const next = { ...current, emailDelivery: { status: 'sending', recipient, startedAt: new Date() }, updatedAt: new Date() }
      await tx.replace('documents', next)
      return next
    })
    if (claimed) {
      let accepted = false, attempted = false
      try {
        const bytes = await documentBytes(database, claimed)
        const title = payload.kind === 'offer' ? 'Offer of employment' : 'Appointment letter'
        const message = `Dear ${fields.employeeName},\n\nPlease find your ${title.toLowerCase()} from ${fields.companyName} attached. Please review and return your signed acceptance to Human Resources.\n\n${fields.signatoryName}\n${fields.signatoryTitle}\n${fields.companyName}`
        const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
        attempted = true
        const result = await sendEmail({ to: recipient, subject: `${title} - ${fields.companyName} - ${fields.employeeName}`, text: message,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-line">${escape(message)}</div>`,
          attachments: [{ filename: document.fileName, content: bytes, contentType: 'application/pdf' }],
        })
        if (result.rejected?.length || (Array.isArray(result.accepted) && !result.accepted.length)) {
          const error = new Error('The mail server rejected the recipient'); error.code = 'EENVELOPE'; throw error
        }
        accepted = true
        await database.mutate('documents', document._id, current => ({ ...current, emailDelivery: { ...current.emailDelivery, status: 'sent', sentAt: new Date(), messageId: result.messageId || '' }, updatedAt: new Date() }))
        document.emailDelivery = { status: 'sent', recipient }
      } catch (error) {
        // Never retry an ambiguous SMTP outcome automatically: the recipient may
        // already have received the message, even when acknowledgement was lost.
        const definitelyFailed = !attempted || (!accepted && (['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EDNS'].includes(error.code) || /not configured|transporter not initialized|missing.*(?:email|smtp)|email.*configuration/i.test(error.message)))
        const status = accepted ? 'sent' : definitelyFailed ? 'failed' : 'unknown'
        emailError = accepted
          ? 'The mail server accepted the letter, but its delivery status could not be saved. Check with HR before sending again.'
          : definitelyFailed
            ? 'The PDF is saved in employee documents, but email delivery failed. Check the email configuration or recipient and retry.'
            : 'The PDF is saved, but the mail server did not confirm delivery. Check with HR before sending again to avoid duplicate emails.'
        await database.mutate('documents', document._id, current => ({ ...current, emailDelivery: { ...current.emailDelivery, status }, updatedAt: new Date() })).catch(() => {})
        document.emailDelivery = { status, recipient }
      }
    } else {
      document = await database.get('documents', document._id)
      if (document.emailDelivery?.status === 'sending') emailError = 'The letter is saved. Email delivery is already in progress; check its status before retrying.'
      if (document.emailDelivery?.status === 'unknown') emailError = 'Email delivery is unconfirmed. Check with HR before sending again to avoid duplicate emails.'
    }
  }
  return { document: { _id: document._id, name: document.name, fileName: document.fileName, fileUrl: document.fileUrl, fileType: document.fileType, emailDelivery: document.emailDelivery }, emailError }
}
