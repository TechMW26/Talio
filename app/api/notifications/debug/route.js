import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { SCHEDULE_OPTIONS, processNotificationSchedules } from '@/lib/scheduledNotifications.server'
import { financeFilter as filter } from '@/lib/finance.server'
async function handle(request, method) {
  try {
    const auth = await getAuthAndDatabase(request, SCHEDULE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!(method === 'POST' ? ['admin', 'super_admin'] : ['admin', 'super_admin', 'hr']).includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    const database = auth.database, now = new Date()
    // Manual administration only processes this tenant, never every tenant.
    if (method === 'POST') return NextResponse.json({ success: true, result: await processNotificationSchedules(database, now) })
    const scheduledFilters = [filter('status', 'pending')], recurringFilters = [filter('isActive', true)]
    const [scheduled, recurring, pending, sent, failed, active, inactive, dueScheduled, dueRecurring] = await Promise.all([
      database.list('schedulednotifications', { filters: scheduledFilters, orderBy: [{ field: 'scheduledFor', direction: 'asc' }], limit: 10 }),
      database.list('recurringnotifications', { filters: recurringFilters, orderBy: [{ field: 'nextScheduledAt', direction: 'asc' }], limit: 10 }),
      database.count('schedulednotifications', scheduledFilters), database.count('schedulednotifications', [filter('status', 'sent')]), database.count('schedulednotifications', [filter('status', 'failed')]),
      database.count('recurringnotifications', recurringFilters), database.count('recurringnotifications', [filter('isActive', false)]),
      database.count('schedulednotifications', [...scheduledFilters, filter('scheduledFor', now, '<=')]), database.count('recurringnotifications', [...recurringFilters, filter('nextScheduledAt', now, '<=')]),
    ])
    const summary = (row, field) => ({ id: row._id, title: row.title, targetType: row.targetType, frequency: row.frequency, scheduledFor: row.scheduledFor, nextScheduledAt: row.nextScheduledAt, lastSentAt: row.lastSentAt, totalSent: row.totalSent || 0, isDue: Boolean(row[field] && new Date(row[field]) <= now), timeUntil: row[field] ? Math.round((new Date(row[field]) - now) / 60000) + ' minutes' : 'Not scheduled', settings: { dailyTime: row.dailyTime, weeklyDays: row.weeklyDays, weeklyTime: row.weeklyTime, monthlyDay: row.monthlyDay, monthlyTime: row.monthlyTime } })
    const pendingList = scheduled.records.map(row => summary(row, 'scheduledFor')), activeList = recurring.records.map(row => summary(row, 'nextScheduledAt'))
    return NextResponse.json({ success: true, data: { currentTime: now.toISOString(), cronSecretConfigured: Boolean(process.env.CRON_SECRET), scheduled: { pending, due: dueScheduled, sent, failed, pendingList, dueNow: pendingList.filter(row => row.isDue) }, recurring: { active, due: dueRecurring, inactive, activeList, dueNow: activeList.filter(row => row.isDue) } } })
  } catch (error) { console.error('[Notification diagnostics]', error.message); return NextResponse.json({ success: false, message: 'Could not process notification diagnostics' }, { status: 500 }) }
}
export const GET = request => handle(request, 'GET')
export const POST = request => handle(request, 'POST')
