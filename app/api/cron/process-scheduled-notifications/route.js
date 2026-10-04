import { NextResponse } from 'next/server'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { getFirestoreSystemDatabase, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { SCHEDULE_OPTIONS, processNotificationSchedules } from '@/lib/scheduledNotifications.server'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(request) {
  const denied = getCronAuthErrorResponse(request)
  if (denied) return denied
  try {
    const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive', 'serviceStatus', 'isSetupComplete'] } })
    const tenants = await collectFirestorePages(system, 'tenantcompanies', { filters: [{ field: 'isActive', operator: '==', value: true }, { field: 'serviceStatus', operator: 'in', value: ['active', 'trial'] }, { field: 'isSetupComplete', operator: '==', value: true }] })
    const data = { tenantsProcessed: 0, totalScheduled: { processed: 0, failed: 0 }, totalRecurring: { processed: 0, failed: 0 }, totalMeetingReminders: { processed: 0, failed: 0 }, tenantResults: [] }
    for (const tenant of tenants) {
      try {
        const database = await getFirestoreTenantDatabase(tenant.databaseName, SCHEDULE_OPTIONS), result = await processNotificationSchedules(database)
        data.tenantsProcessed++; data.tenantResults.push({ tenantName: tenant.name, tenantSlug: tenant.slug, ...result })
        for (const [source, target] of [['scheduled', 'totalScheduled'], ['recurring', 'totalRecurring'], ['meetingReminders', 'totalMeetingReminders']]) for (const key of ['processed', 'failed']) data[target][key] += result[source][key]
      } catch (error) { data.tenantResults.push({ tenantSlug: tenant.slug, error: 'Notification processing failed' }); console.error('[Tenant notification scheduler]', tenant.slug, error.message) }
    }
    return NextResponse.json({ success: true, data })
  } catch (error) { console.error('[Notification scheduler]', error.message); return NextResponse.json({ success: false, message: 'Could not process scheduled notifications' }, { status: 500 }) }
}
