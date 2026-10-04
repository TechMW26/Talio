import { readAdminPage, readReportPages } from './platform/firestoreSuperadmin.server'
export const ONBOARDING_STORE_OPTIONS = { queryFields: { onboardingemails: ['status', 'queued', 'scheduledFor', 'createdAt', 'recipientName', 'recipientEmail', 'employeeCode', 'sentAt', 'searchGrams'], employees: ['email'], users: ['email'] } }
export async function onboardingEmailView(database, record) {
  if (!record) return null
  const { passwordSent, encryptedPasswordSent, deliveryToken, searchGrams, ...publicRecord } = record
  const [employee, user, retriedBy] = await Promise.all([
    record.employee ? database.get('employees', String(record.employee)) : null,
    record.user ? database.get('users', String(record.user)) : null,
    record.retriedBy ? database.get('users', String(record.retriedBy)) : null,
  ])
  return { ...publicRecord,
    employee: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, profilePicture: employee.profilePicture, email: employee.email } : null,
    user: user ? { _id: user._id, email: user.email, role: user.role } : null,
    retriedBy: retriedBy ? { _id: retriedBy._id, email: retriedBy.email } : null,
  }
}
export async function listOnboardingEmails(database, query) {
  const page = Math.max(1, parseInt(query.get('page')) || 1), limit = Math.min(100, Math.max(1, parseInt(query.get('limit')) || 20))
  const filters = [], status = query.get('status'), search = (query.get('search') || '').trim().toLowerCase().slice(0, 100)
  if (status && ['sent', 'failed', 'pending'].includes(status)) filters.push({ field: 'status', operator: '==', value: status })
  const sortBy = ['createdAt', 'recipientName', 'recipientEmail', 'employeeCode', 'sentAt', 'status'].includes(query.get('sortBy')) ? query.get('sortBy') : 'createdAt'
  const direction = query.get('sortOrder') === 'asc' ? 'asc' : 'desc'
  let rows, total, nextCursor
  if (search) {
    filters.push({ field: 'searchGrams', operator: 'array-contains', value: search.slice(0, 3) })
    const candidates = await readReportPages(database, 'onboardingemails', { filters })
    const matched = candidates.filter(row => [row.recipientName, row.recipientEmail, row.employeeCode].some(value => String(value || '').toLowerCase().includes(search)))
      .sort((a, b) => (a[sortBy] > b[sortBy] ? 1 : a[sortBy] < b[sortBy] ? -1 : 0) * (direction === 'asc' ? 1 : -1))
    total = matched.length; rows = matched.slice((page - 1) * limit, page * limit)
  } else {
    const [result, count] = await Promise.all([readAdminPage(database, 'onboardingemails', { filters, orderBy: [{ field: sortBy, direction }], skip: (page - 1) * limit, limit, cursor: query.get('cursor') }), database.count('onboardingemails', filters)])
    rows = result.records; total = count; nextCursor = result.nextCursor
  }
  const [sent, failed, pending, settings] = await Promise.all([
    ...['sent', 'failed', 'pending'].map(value => database.count('onboardingemails', [{ field: 'status', operator: '==', value }])),
    database.list('companysettings', { limit: 1 }),
  ])
  return { data: await Promise.all(rows.map(row => onboardingEmailView(database, row))), pagination: { page, limit, total, pages: Math.ceil(total / limit), nextCursor }, stats: { sent, failed, pending, total: sent + failed + pending }, onboardingEmailsEnabled: settings.records[0]?.notifications?.onboardingEmailsEnabled !== false }
}
export async function queueFailedOnboardingEmails(database, delayMinutes = 5) {
  if (!Number.isFinite(delayMinutes) || delayMinutes < 0 || delayMinutes > 1440) throw Object.assign(new Error('Invalid retry delay'), { status: 400 })
  const candidates = await readReportPages(database, 'onboardingemails', { filters: [{ field: 'status', operator: '==', value: 'failed' }] })
  const scheduledFor = new Date(Date.now() + delayMinutes * 60000)
  let queuedCount = 0
  for (let offset = 0; offset < candidates.length; offset += 50) queuedCount += await database.transaction(async tx => {
    let count = 0
    for (const candidate of candidates.slice(offset, offset + 50)) {
      const current = await tx.get('onboardingemails', String(candidate._id))
      if (!current || current.status !== 'failed' || current.queued || (current.autoRetryCount || 0) >= 5 || new Date(current.deliveryLeaseUntil || 0) > new Date()) continue
      await tx.replace('onboardingemails', { ...current, status: 'pending', queued: true, scheduledFor, errorMessage: 'Queued for automatic retry', autoRetryCount: (current.autoRetryCount || 0) + 1, updatedAt: new Date() })
      count++
    }
    return count
  })
  return { queuedCount, scheduledFor }
}
export async function onboardingQueueStatus(database) {
  const eq = (field, value) => ({ field, operator: '==', value })
  const [total, ready, pending, failed, next] = await Promise.all([
    database.count('onboardingemails', [eq('queued', true)]),
    database.count('onboardingemails', [eq('queued', true), { field: 'scheduledFor', operator: '<=', value: new Date() }]),
    database.count('onboardingemails', [eq('status', 'pending'), eq('queued', false)]),
    database.count('onboardingemails', [eq('status', 'failed')]),
    database.list('onboardingemails', { filters: [eq('queued', true), { field: 'scheduledFor', operator: '>', value: new Date() }], orderBy: [{ field: 'scheduledFor', direction: 'asc' }], limit: 1 }),
  ])
  return { total, ready, pending, failed, nextScheduledAt: next.records[0]?.scheduledFor || null }
}
