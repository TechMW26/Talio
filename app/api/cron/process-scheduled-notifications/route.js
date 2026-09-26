import { NextResponse } from 'next/server'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'
import { getTenantModels } from '@/lib/tenantModels'
import { sendPushToUsers } from '@/lib/pushNotification'
import { buildMeetingReminders } from '@/lib/meetings/meetingUpdate'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Process scheduled and recurring notifications for a single tenant
 */
async function processNotificationsForTenant(tenant, now) {
  const results = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    scheduled: { total: 0, processed: 0, failed: 0 },
    recurring: { total: 0, processed: 0, failed: 0 },
    meetingReminders: { total: 0, processed: 0, failed: 0 }
  }

  try {
    // Get tenant-specific models
    const models = await getTenantModels(tenant.databaseName, [
      'ScheduledNotification', 'RecurringNotification', 'Notification', 'User', 'Employee', 'Department', 'Meeting'
    ])
    const { ScheduledNotification, RecurringNotification, Notification, User, Employee, Meeting } = models

    // ========== PROCESS SCHEDULED NOTIFICATIONS ==========
    const dueNotifications = await ScheduledNotification.find({
      status: 'pending',
      scheduledFor: { $lte: now }
    }).populate('targetDepartment')

    results.scheduled.total = dueNotifications.length

    for (const scheduledNotif of dueNotifications) {
      try {
        // Determine target user IDs based on targetType
        let userIds = []

        if (scheduledNotif.targetType === 'all') {
          const users = await User.find({}).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (scheduledNotif.targetType === 'department') {
          const deptEmployees = await Employee.find({
            department: scheduledNotif.targetDepartment,
            status: 'active'
          }).select('_id')
          const employeeIds = deptEmployees.map(e => e._id)
          const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (scheduledNotif.targetType === 'role') {
          const users = await User.find({
            role: { $in: scheduledNotif.targetRoles }
          }).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (scheduledNotif.targetType === 'specific') {
          userIds = scheduledNotif.targetUsers.map(id => id.toString())
        }

        if (userIds.length === 0) {
          scheduledNotif.status = 'failed'
          scheduledNotif.failureReason = 'No users found matching criteria'
          await scheduledNotif.save()
          results.scheduled.failed++
          continue
        }

        // Create notification records in database for each user
        const notificationRecords = []
        const sendTime = new Date()

        for (const userId of userIds) {
          notificationRecords.push({
            user: userId,
            title: scheduledNotif.title,
            message: scheduledNotif.message,
            url: scheduledNotif.url || '/dashboard',
            type: 'custom',
            priority: 'medium',
            data: {
              sentBy: scheduledNotif.createdBy.toString()
            },
            sentBy: scheduledNotif.createdBy,
            sentByRole: scheduledNotif.createdByRole,
            deliveryStatus: {
              fcm: { sent: false }
            },
            createdAt: sendTime
          })
        }

        // Save all notifications to database
        let savedNotifications = []
        try {
          savedNotifications = await Notification.insertMany(notificationRecords)
        } catch (dbError) {
          console.error(`[Cron] Error saving notifications for tenant ${tenant.slug}:`, dbError)
        }

        // Send Firebase push notification
        let pushResult = { success: false }
        try {
          pushResult = await sendPushToUsers(
            userIds,
            {
              title: scheduledNotif.title,
              body: scheduledNotif.message
            },
            {
              models,
              skipPersistence: savedNotifications.length > 0,
              data: {
                type: 'custom',
                sentBy: scheduledNotif.createdBy.toString(),
                url: scheduledNotif.url || '/dashboard'
              },
              url: scheduledNotif.url || '/dashboard',
              type: 'custom'
            }
          )

          if (pushResult.success && savedNotifications.length > 0) {
            await Notification.updateMany(
              { _id: { $in: savedNotifications.map(n => n._id) } },
              {
                'deliveryStatus.fcm.sent': true,
                'deliveryStatus.fcm.sentAt': sendTime
              }
            )
          }
        } catch (firebaseError) {
          console.error(`[Cron] Firebase error for tenant ${tenant.slug}:`, firebaseError)
        }

        // Update scheduled notification status
        scheduledNotif.status = pushResult.success || savedNotifications.length > 0 ? 'sent' : 'failed'
        scheduledNotif.sentAt = sendTime
        scheduledNotif.recipientCount = userIds.length

        if (!pushResult.success && savedNotifications.length === 0) {
          scheduledNotif.failureReason = 'Failed to send notification'
        }

        await scheduledNotif.save()

        if (scheduledNotif.status === 'sent') {
          results.scheduled.processed++
        } else {
          results.scheduled.failed++
        }

      } catch (notifError) {
        console.error(`[Cron] Error processing notification for tenant ${tenant.slug}:`, notifError)
        try {
          scheduledNotif.status = 'failed'
          scheduledNotif.failureReason = notifError.message
          await scheduledNotif.save()
        } catch (saveError) {}
        results.scheduled.failed++
      }
    }

    // ========== PROCESS RECURRING NOTIFICATIONS ==========
    const dueRecurring = await RecurringNotification.find({
      isActive: true,
      nextScheduledAt: { $lte: now },
      $or: [
        { endDate: null },
        { endDate: { $gte: now } }
      ]
    }).populate('targetDepartment')

    results.recurring.total = dueRecurring.length

    for (const recurringNotif of dueRecurring) {
      try {
        // Determine target user IDs
        let userIds = []

        if (recurringNotif.targetType === 'all') {
          const users = await User.find({}).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (recurringNotif.targetType === 'department') {
          const deptEmployees = await Employee.find({
            department: recurringNotif.targetDepartment,
            status: 'active'
          }).select('_id')
          const employeeIds = deptEmployees.map(e => e._id)
          const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (recurringNotif.targetType === 'role') {
          const users = await User.find({
            role: { $in: recurringNotif.targetRoles }
          }).select('_id')
          userIds = users.map(u => u._id.toString())
        } else if (recurringNotif.targetType === 'specific') {
          userIds = recurringNotif.targetUsers.map(id => id.toString())
        }

        if (userIds.length === 0) {
          recurringNotif.totalFailure = (recurringNotif.totalFailure || 0) + 1
          recurringNotif.nextScheduledAt = recurringNotif.calculateNextSchedule()
          await recurringNotif.save()
          results.recurring.failed++
          continue
        }

        // Create notification records
        const notificationRecords = []
        const sendTime = new Date()

        for (const userId of userIds) {
          notificationRecords.push({
            user: userId,
            title: recurringNotif.title,
            message: recurringNotif.message,
            url: recurringNotif.url || '/dashboard',
            type: 'custom',
            priority: 'medium',
            data: {
              sentBy: recurringNotif.createdBy.toString(),
              recurringId: recurringNotif._id.toString()
            },
            sentBy: recurringNotif.createdBy,
            sentByRole: recurringNotif.createdByRole,
            deliveryStatus: {
              fcm: { sent: false }
            },
            createdAt: sendTime
          })
        }

        // Save notifications to database
        let savedNotifications = []
        try {
          savedNotifications = await Notification.insertMany(notificationRecords)
        } catch (dbError) {
          console.error(`[Cron] Error saving recurring notifications for tenant ${tenant.slug}:`, dbError)
        }

        // Send push notification
        let pushResult = { success: false }
        try {
          pushResult = await sendPushToUsers(
            userIds,
            {
              title: recurringNotif.title,
              body: recurringNotif.message
            },
            {
              data: {
                type: 'custom',
                sentBy: recurringNotif.createdBy.toString(),
                recurringId: recurringNotif._id.toString(),
                url: recurringNotif.url || '/dashboard'
              },
              url: recurringNotif.url || '/dashboard',
              type: 'custom'
            }
          )

          if (pushResult.success && savedNotifications.length > 0) {
            await Notification.updateMany(
              { _id: { $in: savedNotifications.map(n => n._id) } },
              {
                'deliveryStatus.fcm.sent': true,
                'deliveryStatus.fcm.sentAt': sendTime
              }
            )
          }
        } catch (firebaseError) {
          console.error(`[Cron] Firebase error for recurring in tenant ${tenant.slug}:`, firebaseError)
        }

        // Update recurring notification stats
        recurringNotif.lastSentAt = sendTime
        recurringNotif.totalSent = (recurringNotif.totalSent || 0) + 1

        if (pushResult.success || savedNotifications.length > 0) {
          recurringNotif.totalSuccess = (recurringNotif.totalSuccess || 0) + 1
          results.recurring.processed++
        } else {
          recurringNotif.totalFailure = (recurringNotif.totalFailure || 0) + 1
          results.recurring.failed++
        }

        // Calculate next scheduled time
        recurringNotif.nextScheduledAt = recurringNotif.calculateNextSchedule()

        // If next schedule is null, deactivate (end date passed)
        if (!recurringNotif.nextScheduledAt) {
          recurringNotif.isActive = false
        }

        await recurringNotif.save()

      } catch (recurringError) {
        console.error(`[Cron] Error processing recurring for tenant ${tenant.slug}:`, recurringError)
        results.recurring.failed++
      }
    }

    // ========== PROCESS MEETING REMINDERS ==========
    // Backfill meetings created before reminder timestamps were persisted.
    // Limiting this to the next 24 hours keeps each cron run bounded while
    // ensuring every upcoming legacy meeting enters the normal due queue.
    const legacyReminderMeetings = await Meeting.find({
      status: 'scheduled',
      scheduledStart: { $gte: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      $or: [
        { 'reminders.0': { $exists: false } },
        { 'reminders.time': { $exists: false } },
      ],
    }).select('_id scheduledStart reminders').lean()
    for (const meeting of legacyReminderMeetings) {
      await Meeting.updateOne({ _id: meeting._id }, {
        $set: { reminders: buildMeetingReminders(meeting.reminders, new Date(meeting.scheduledStart)) },
      })
    }

    // Claim each embedded reminder atomically before delivering it. This makes
    // overlapping Vercel cron invocations idempotent.
    const dueMeetings = await Meeting.find({
      status: 'scheduled',
      reminders: { $elemMatch: { time: { $lte: now }, sent: { $ne: true } } },
      scheduledEnd: { $gte: now },
    }).select('_id title scheduledStart organizer invitees reminders').lean()

    for (const meeting of dueMeetings) {
      const dueIndexes = (meeting.reminders || [])
        .map((reminder, index) => ({ reminder, index }))
        .filter(({ reminder }) => reminder?.time && new Date(reminder.time) <= now && reminder.sent !== true)
      results.meetingReminders.total += dueIndexes.length

      for (const { reminder, index } of dueIndexes) {
        const claim = await Meeting.updateOne({
          _id: meeting._id,
          status: 'scheduled',
          [`reminders.${index}.sent`]: { $ne: true },
          [`reminders.${index}.time`]: { $lte: now },
        }, {
          $set: {
            [`reminders.${index}.sent`]: true,
            [`reminders.${index}.sentAt`]: now,
          },
        })
        if (!claim.modifiedCount) continue

        try {
          const employeeIds = [
            meeting.organizer,
            ...(meeting.invitees || []).map((invitee) => invitee.employee),
          ].filter(Boolean)
          const users = await User.find({ employeeId: { $in: employeeIds }, isActive: { $ne: false } }).select('_id').lean()
          const userIds = [...new Set(users.map((user) => String(user._id)))]
          if (!userIds.length) throw new Error('No active meeting participants found')

          const startLabel = new Date(meeting.scheduledStart).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          const title = 'Meeting starting soon'
          const message = `${meeting.title} starts at ${startLabel}`
          const url = `/dashboard/meetings/${meeting._id}`
          await Notification.insertMany(userIds.map((userId) => ({
            user: userId,
            title,
            message,
            type: 'scheduled',
            link: url,
            url,
            metadata: { meetingId: String(meeting._id), reminderType: reminder.type || '15min' },
            data: { meetingId: String(meeting._id), reminderType: reminder.type || '15min' },
          })))
          await sendPushToUsers(userIds, { title, body: message }, {
            type: 'meeting-reminder',
            url,
            data: { meetingId: String(meeting._id), reminderType: reminder.type || '15min' },
          }).catch(() => ({ success: false }))
          results.meetingReminders.processed++
        } catch (error) {
          await Meeting.updateOne({ _id: meeting._id }, {
            $set: {
              [`reminders.${index}.sent`]: false,
              [`reminders.${index}.sentAt`]: null,
            },
          }).catch(() => {})
          results.meetingReminders.failed++
          console.error(`[Cron] Meeting reminder failed for tenant ${tenant.slug}:`, error)
        }
      }
    }

    return results

  } catch (error) {
    console.error(`[Cron] Error processing tenant ${tenant.slug}:`, error)
    return { ...results, error: error.message }
  }
}

/**
 * GET /api/cron/process-scheduled-notifications
 * 
 * MULTI-TENANT: Iterates over ALL active tenants and processes scheduled notifications
 */
export async function GET(request) {
  try {
    const authError = getCronAuthErrorResponse(request)
    if (authError) return authError

    const now = new Date()
    console.log(`[Cron] Starting multi-tenant notification processing at ${now.toISOString()}`)

    // Connect to superadmin DB and get all active tenants
    await connectSuperadminDB()
    const TenantCompany = await getTenantCompanyModel()

    const activeTenants = await TenantCompany.find({
      isActive: true,
      serviceStatus: { $in: ['active', 'trial'] },
      isSetupComplete: true
    }).lean()

    console.log(`[Cron] Found ${activeTenants.length} active tenants to process`)

    const allResults = {
      tenantsProcessed: activeTenants.length,
      totalScheduled: { processed: 0, failed: 0 },
      totalRecurring: { processed: 0, failed: 0 },
      totalMeetingReminders: { processed: 0, failed: 0 },
      tenantResults: []
    }

    // Process each tenant
    for (const tenant of activeTenants) {
      console.log(`[Cron] Processing notifications for tenant: ${tenant.name}`)
      const tenantResult = await processNotificationsForTenant(tenant, now)
      allResults.tenantResults.push(tenantResult)
      
      allResults.totalScheduled.processed += tenantResult.scheduled.processed
      allResults.totalScheduled.failed += tenantResult.scheduled.failed
      allResults.totalRecurring.processed += tenantResult.recurring.processed
      allResults.totalRecurring.failed += tenantResult.recurring.failed
      allResults.totalMeetingReminders.processed += tenantResult.meetingReminders.processed
      allResults.totalMeetingReminders.failed += tenantResult.meetingReminders.failed
    }

    console.log(`[Cron] Completed. Scheduled: ${allResults.totalScheduled.processed} processed, ${allResults.totalScheduled.failed} failed. Recurring: ${allResults.totalRecurring.processed} processed, ${allResults.totalRecurring.failed} failed. Meeting reminders: ${allResults.totalMeetingReminders.processed} processed, ${allResults.totalMeetingReminders.failed} failed.`)

    return NextResponse.json({
      success: true,
      message: `Processed ${allResults.totalScheduled.processed} scheduled, ${allResults.totalRecurring.processed} recurring, ${allResults.totalMeetingReminders.processed} meeting reminders. Failed: ${allResults.totalScheduled.failed} scheduled, ${allResults.totalRecurring.failed} recurring, ${allResults.totalMeetingReminders.failed} meeting reminders`,
      data: allResults
    })
  } catch (error) {
    console.error('[Cron] Process scheduled notifications error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to process scheduled notifications' },
      { status: 500 }
    )
  }
}
