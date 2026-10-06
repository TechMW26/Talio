import { failure, idOf, isHr } from './resignation.server'
import { applyLifecycleAction, hydrateEmployeeLifecycle, toIstDateKey } from './employeeLifecycle.server'
import { getResignationStore, loadExitAssets } from './resignationStore.server'
import { validateSettlement } from './settlement'
import { employmentLetterDefaults } from './employmentLetter'
import { generateEmploymentLetterPdf, loadEmploymentLetterLogo } from './employmentLetterPdf.server'
import { sendEmail } from '@/lib/mailer'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob, buildAuthenticatedBlobUrl, buildTenantBlobPrefix } from '@/lib/platform/blobStorage.server'
import { createHash } from 'node:crypto'

export function startResignationExit(employee, record) {
  const current = hydrateEmployeeLifecycle(employee)
  if (idOf(current.offboarding?.resignationRequest) === idOf(record._id)) return current
  if (current.offboarding?.status && current.offboarding.status !== 'not_started') throw failure('An offboarding already exists for this employee. HR must reconcile it before continuing.', 409)
  const next = applyLifecycleAction(current, 'start_offboarding', { resignationDate: record.createdAt, lastWorkingDate: record.proposal.lastWorkingDate, reason: record.reason, separationType: 'resignation' }).lifecycle
  next.offboarding.resignationRequest = record._id
  return next
}

export async function acceptAndStartExit(store, current, input, update, event) {
  return store.transaction(async tx => {
    const [employee, latest] = await Promise.all([
      tx.get('employees', idOf(current.employee)),
      tx.get('resignationrequests', idOf(current)),
    ])
    if (!employee || ['resigned', 'terminated'].includes(employee.status)) throw failure('Active employment record required', 409)
    if (!latest || latest.status !== current.status || latest.version !== input.version) throw failure('Request changed. Refresh before accepting.', 409)
    const lifecycle = startResignationExit(employee, latest)
    const now = new Date()
    const record = { ...latest, ...update, version: latest.version + 1, timeline: [...(latest.timeline || []), event], updatedAt: now }
    await tx.replace('resignationrequests', record)
    await tx.replace('employees', { ...employee, lifecycle, dateOfLeaving: latest.proposal.lastWorkingDate, __v: Number(employee.__v || 0) + 1, updatedAt: now })
    return record
  })
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
  const store = await getResignationStore(auth)
  const employee = await store.get('employees', idOf(record.employee))
  if (!employee) throw failure('Employee not found', 404)
  if (idOf(employee.lifecycle?.offboarding?.resignationRequest) !== idOf(record._id)) throw failure('Start the linked offboarding before finalising', 409)
  const clearance = await loadExitAssets(store, employee)
  let settlement
  try { settlement = assertExitReady(record, clearance.offboarding, input) } catch (error) { throw failure(error.message, error.status || 400) }
  const recipient = employee.email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || '')) throw failure('Correct the employee email address before finalising')
  const [company, settings, preferences, signer] = await Promise.all([
    employee.company ? store.get('companies', idOf(employee.company)) : null,
    store.list('companysettings', { limit: 1 }).then(page => page.records[0]), store.list('systempreferences', { limit: 1 }).then(page => page.records[0]),
    actor.employeeId ? store.get('employees', idOf(actor.employeeId)) : null,
  ])
  const fields = employmentLetterDefaults({ employee, company: company || {}, settings: settings || {}, preferences: preferences || {}, signer: signer || {} })
  for (const key of ['companyName', 'companyAddress', 'employeeName', 'employeeCode', 'signatoryName']) if (!fields[key]) throw failure(`Complete ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} in company/employee records before issuing exit documents`)
  const logoSource = company?.logo || settings?.companyLogo || preferences?.companyLogo || preferences?.lightModeLogo
  let logo
  try { logo = await loadEmploymentLetterLogo(logoSource, auth.tenant.databaseName) } catch (error) { throw failure(error.message) }
  const reference = `EXIT/${fields.employeeCode}/${idOf(record._id)}`
  const bytes = generateEmploymentLetterPdf({ fields, logo, reference, title: 'RELIEVING & FINAL SETTLEMENT', paragraphs: exitParagraphs({ employee, record, settlement, paymentReference: input.paymentReference.trim(), signer: `${fields.signatoryName}\n${fields.companyName}` }) })
  const documentId = idOf(record)
  const fileName = `exit-settlement-${fields.employeeCode.replace(/[^a-z0-9-]/gi, '-')}.pdf`
  const now = new Date()
  const storage = await uploadTenantBlob({ tenantId: auth.tenant.databaseName, category: 'documents', ownerId: idOf(actor), filename: fileName, body: bytes, contentType: 'application/pdf', access: 'private' })
  storage.sha256 = createHash('sha256').update(bytes).digest('hex')
  const fileUrl = buildAuthenticatedBlobUrl(storage.pathname)
  try { await store.transaction(async tx => {
    const [latest, latestRequest] = await Promise.all([tx.get('employees', idOf(employee)), tx.get('resignationrequests', idOf(record))])
    if (Number(latest?.__v || 0) !== Number(employee.__v || 0)) throw failure('Employee clearance or settlement changed. Refresh before finalising.', 409)
    if (!latestRequest || latestRequest.status !== 'accepted' || latestRequest.version !== input.version) throw failure('Request changed. Refresh before finalising.', 409)
    // Read every account and active session into the transaction before writes.
    // Exceeding the atomic budget fails closed instead of leaving a live account.
    const accounts = await tx.list('users', { filters: [{ field: 'employeeId', operator: '==', value: idOf(employee) }], limit: 40, requireComplete: true })
    const sessions = (await Promise.all(accounts.records.map(account => tx.list('usersessions', { filters: [{ field: 'user', operator: '==', value: idOf(account) }, { field: 'isActive', operator: '==', value: true }], limit: 40, requireComplete: true })))).flatMap(page => page.records)
    if (accounts.records.length + sessions.length > 45) throw failure('Revoke excess employee sessions before finalising this exit', 409)
    // Asset assignment is part of the transaction's read set, so a concurrent
    // assignment cannot race the final clearance check.
    const assigned = await tx.list('assets', { filters: [{ field: 'assignedTo', operator: '==', value: idOf(employee) }], limit: 1, requireComplete: true })
    if (assigned.records.length) throw failure('Complete the asset-return checklist first')
    const offboarding = { ...clearance.offboarding, status: 'completed', completedAt: now, assetsReturned: true, accessRevoked: true, fullAndFinalStatus: 'completed', settlement: { ...settlement, savedAt: employee.lifecycle.offboarding.settlement.savedAt, confirmedAt: now, confirmedBy: actor._id, paymentReference: input.paymentReference.trim() } }
    await tx.replace('resignationrequests', { ...latestRequest, status: 'completed', active: false, completedAt: now, exitDocument: documentId, version: latestRequest.version + 1, updatedAt: now, timeline: [...(latestRequest.timeline || []), { action: 'complete_exit', actor: actor._id, at: now, reason: 'HR finalised settlement, documents and separation' }] })
    await tx.replace('employees', { ...latest, lifecycle: { ...latest.lifecycle, stage: 'alumni', offboarding }, status: 'resigned', dateOfLeaving: record.proposal.lastWorkingDate, __v: Number(latest.__v || 0) + 1, updatedAt: now })
    for (const account of accounts.records) await tx.replace('users', { ...account, isActive: false, updatedAt: now })
    for (const session of sessions) await tx.replace('usersessions', { ...session, isActive: false, revokedAt: now, revokedReason: 'Employment exit finalised', updatedAt: now })
    await tx.create('documents', { _id: documentId, sourceKey: `resignation-exit:${record._id}`, employee: employee._id, uploadedBy: actor.employeeId || employee._id, name: fileName, fileName, type: 'application/pdf', fileType: 'application/pdf', url: fileUrl, fileUrl, fileId: storage.pathname, fileSize: bytes.length, storage, category: 'exit', status: 'issued', isActive: true, emailDelivery: { status: 'not_sent', recipient }, generatedLetter: { kind: 'exit', reference, issuedBy: actor._id }, createdAt: now, updatedAt: now })
  }) } catch (error) {
    await deleteTenantBlob(storage.pathname).catch(() => { console.error('[Exit] Failed transaction left a private upload requiring cleanup') })
    throw error
  }
  return documentId
}

export async function emailExitDocument(store, documentId) {
  // Acquire the send state atomically. Unknown SMTP results are never auto-retried.
  const claimed = await store.transaction(async tx => {
    const current = await tx.get('documents', idOf(documentId))
    if (!current || !['not_sent', 'failed'].includes(current.emailDelivery?.status)) return { doc: null, delivery: current?.emailDelivery }
    const doc = { ...current, emailDelivery: { ...current.emailDelivery, status: 'sending', startedAt: new Date() }, updatedAt: new Date() }
    await tx.replace('documents', doc)
    return { doc }
  })
  if (!claimed.doc) return claimed.delivery
  const { doc } = claimed
  let accepted = false
  let attempted = false
  try {
    let bytes
    if (doc.storage?.pathname) {
      const prefix = `${buildTenantBlobPrefix({ tenantId: store.databaseName, category: 'documents', ownerId: idOf(doc.generatedLetter?.issuedBy) })}/`
      if (doc.storage.access !== 'private' || !doc.storage.pathname.startsWith(prefix) || doc.storage.pathname.includes('..')) throw new Error('Exit document belongs to another tenant or owner')
      const blob = await getTenantBlob(doc.storage.pathname, { access: 'private' })
      if (!blob?.stream || blob.statusCode !== 200) throw new Error('Exit document is unavailable')
      bytes = Buffer.from(await new Response(blob.stream).arrayBuffer())
      if (bytes.length !== doc.fileSize || createHash('sha256').update(bytes).digest('hex') !== doc.storage.sha256) throw new Error('Exit document checksum mismatch')
    } else {
      // Existing imported letters retain their original bytes until separately
      // verified media migration; new letters are always stored in private Blob.
      bytes = Buffer.isBuffer(doc.generatedPdf) ? doc.generatedPdf : Buffer.from(doc.generatedPdf.buffer)
    }
    attempted = true
    const result = await sendEmail({ to: doc.emailDelivery.recipient, subject: 'Your relieving and full-and-final settlement documents', text: 'Please find your relieving and full-and-final settlement documents attached. Please contact Human Resources if you have any questions.', html: '<p>Please find your relieving and full-and-final settlement documents attached. Please contact Human Resources if you have any questions.</p>', attachments: [{ filename: doc.fileName, content: bytes, contentType: 'application/pdf' }] })
    if (result.rejected?.length || (Array.isArray(result.accepted) && !result.accepted.length)) throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' })
    accepted = true
    await store.mutate('documents', idOf(documentId), current => ({ ...current, emailDelivery: { ...current.emailDelivery, status: 'sent', sentAt: new Date(), messageId: result.messageId || '' } }))
    return { status: 'sent', recipient: doc.emailDelivery.recipient }
  } catch (error) {
    const definite = !attempted || (!accepted && (['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EDNS'].includes(error.code) || /not configured|transporter not initialized/i.test(error.message)))
    const status = accepted ? 'sent' : definite ? 'failed' : 'unknown'
    await store.mutate('documents', idOf(documentId), current => ({ ...current, emailDelivery: { ...current.emailDelivery, status } })).catch(() => {})
    return { status, recipient: doc.emailDelivery.recipient }
  }
}
