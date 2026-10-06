import { NextResponse } from 'next/server'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { getFirestoreProvisioningContext, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { withFirestoreLease } from '@/lib/platform/firestoreLease.server'
import { TODO_REMINDER_STORE_OPTIONS, processTenantTodoReminders } from '@/lib/todoReminders.server'

export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(request) {
  const authError = getCronAuthErrorResponse(request)
  if (authError) return authError
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return NextResponse.json({ success: true, skipped: true, message: 'Reminder delivery disabled during local acceptance' })
  try {
    const { catalog } = await getFirestoreProvisioningContext()
    const totals = { processed: 0, queued: 0, failed: 0, tenants: 0 }
    for (const tenant of catalog.tenants.filter(item => item.active !== false)) {
      try {
        const database = await getFirestoreTenantDatabase(tenant.databaseName, TODO_REMINDER_STORE_OPTIONS)
        const result = await withFirestoreLease(database, 'cron:todo-reminders', { ttlMs: 300000 }, () => processTenantTodoReminders(database, enqueueBackgroundJob))
        if (result.acquired) { for (const key of ['processed', 'queued', 'failed']) totals[key] += result.value[key]; totals.tenants++ }
      } catch { totals.failed++ }
    }
    return NextResponse.json({ success: totals.failed === 0, data: totals }, { status: totals.failed ? 503 : 200 })
  } catch {
    return NextResponse.json({ success: false, message: 'Reminder processing failed; pending deliveries will be retried' }, { status: 503 })
  }
}
