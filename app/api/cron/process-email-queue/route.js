import { NextResponse } from 'next/server'
import { retryOnboardingEmail } from '@/lib/mailer'
import { processProjectEmailNotificationLog, PROJECT_EMAIL_STORE_OPTIONS } from '@/lib/projectEmailNotifications'
import { getSuperadminStore, getActiveCompanies } from '@/lib/platform/firestoreSuperadmin.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { ONBOARDING_STORE_OPTIONS, queueFailedOnboardingEmails } from '@/lib/onboardingEmails.server'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
export const maxDuration = 120
const options = { queryFields: { ...ONBOARDING_STORE_OPTIONS.queryFields, ...PROJECT_EMAIL_STORE_OPTIONS.queryFields }, constraints: PROJECT_EMAIL_STORE_OPTIONS.constraints }

export async function GET(request) {
  const denied = getCronAuthErrorResponse(request)
  if (denied) return denied
  try {
    const companies = await getActiveCompanies(await getSuperadminStore())
    const now = new Date(), started = Date.now()
    const results = { processed: 0, sent: 0, rescheduled: 0, failed: 0, errors: [], tenants: {}, projectNotifications: { processed: 0, sent: 0, rescheduled: 0, failed: 0 } }
    for (const company of companies) {
      if (Date.now() - started > 100000) break
      if (['paused', 'suspended', 'terminated'].includes(company.serviceStatus)) continue
      try {
        const database = await getFirestoreTenantDatabase(company.databaseName, options)
        const filters = [{ field: 'queued', operator: '==', value: true }, { field: 'scheduledFor', operator: '<=', value: now }]
        const [onboarding, project] = await Promise.all(['onboardingemails', 'projectemailnotificationlogs'].map(collection => database.list(collection, { filters, orderBy: [{ field: 'scheduledFor', direction: 'asc' }], limit: 10 })))
        const counts = { found: onboarding.records.length, sent: 0, rescheduled: 0, failed: 0, projectEmailsFound: project.records.length, projectEmailsSent: 0, projectEmailsRescheduled: 0, projectEmailsFailed: 0 }
        results.tenants[company.slug || company.databaseName] = counts
        for (const [isProject, rows] of [[false, onboarding.records], [true, project.records]]) {
          for (const log of rows) {
            if (Date.now() - started > 100000) break
            const result = isProject ? await processProjectEmailNotificationLog(log, database) : await retryOnboardingEmail(log._id, null, database, { onlyQueued: true })
            if (result.busy || result.skipped) continue
            const key = result.success ? 'sent' : result.rateLimited ? 'rescheduled' : 'failed'
            results.processed++; results[key]++
            if (isProject) { results.projectNotifications.processed++; results.projectNotifications[key]++; counts['projectEmails' + key[0].toUpperCase() + key.slice(1)]++ }
            else counts[key]++
            if (key === 'failed') results.errors.push({ emailId: log._id, error: result.error })
            await new Promise(resolve => setTimeout(resolve, 3000))
          }
        }
      } catch (error) { results.errors.push({ tenant: company.slug || company.databaseName, error: error.message }) }
    }
    return NextResponse.json({ success: results.errors.length === 0, message: 'Processed ' + results.processed + ' queued emails', results, timestamp: now.toISOString() })
  } catch (error) { return NextResponse.json({ success: false, error: 'Email queue processing failed' }, { status: 500 }) }
}

export async function POST(request) {
  const denied = getCronAuthErrorResponse(request)
  if (denied) return denied
  try {
    const { action, delayMinutes = 5 } = await request.json()
    if (action !== 'queue-all-failed') return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
    const companies = await getActiveCompanies(await getSuperadminStore())
    let queuedCount = 0
    for (const company of companies) {
      if (['paused', 'suspended', 'terminated'].includes(company.serviceStatus)) continue
      const database = await getFirestoreTenantDatabase(company.databaseName, options)
      queuedCount += (await queueFailedOnboardingEmails(database, delayMinutes)).queuedCount
    }
    return NextResponse.json({ success: true, message: 'Eligible failed onboarding emails queued', queuedCount })
  } catch (error) { return NextResponse.json({ success: false, error: error.status ? error.message : 'Email queue update failed' }, { status: error.status || 500 }) }
}
