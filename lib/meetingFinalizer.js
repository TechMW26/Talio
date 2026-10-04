import { getFirestoreSystemDatabase } from './platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { getMeetingDatabase, populateMeeting, meetingFilter as eq } from './meetings/store.server'
import {
  generateMeetingInsights,
  hasMeetingInsightSource,
  persistMeetingInsights,
  sendMeetingMinutesEmails,
} from './meetingAI.js'
import { emitMeetingUpdate } from './realtimeEvents.js'
import { refreshMeetingAvailability } from './meetings/meetingAvailability.server.js'

const EPOCH_DATE = new Date(0)

const finalizerState = globalThis.__meetingFinalizerState || {
  allTenantsRunning: false,
  databases: new Set(),
}

if (!globalThis.__meetingFinalizerState) {
  globalThis.__meetingFinalizerState = finalizerState
}

const summaryFilters = now => [eq('status', 'completed'), eq('scheduledEnd', now, '<'), eq('needsMeetingInsights', true)]

function getMeetingTargetUserIds(meeting) {
  const userIds = new Set()

  const organizerUserId = meeting?.organizer?.userId?._id?.toString?.()
    || meeting?.organizer?.userId?.toString?.()
  if (organizerUserId) {
    userIds.add(organizerUserId)
  }

  for (const invitee of meeting?.invitees || []) {
    const userId = invitee?.employee?.userId?._id?.toString?.()
      || invitee?.employee?.userId?.toString?.()
    if (userId) {
      userIds.add(userId)
    }
  }

  return Array.from(userIds)
}

function buildMeetingRealtimePayload(meeting) {
  return {
    _id: meeting._id,
    title: meeting.title,
    type: meeting.type,
    roomId: meeting.roomId,
    scheduledStart: meeting.scheduledStart,
    scheduledEnd: meeting.scheduledEnd,
    actualEnd: meeting.actualEnd,
    status: meeting.status,
    isLinkActive: meeting.isLinkActive,
    continuing: meeting.continuing,
    roomEmptySince: meeting.roomEmptySince,
    aiSummary: meeting.aiSummary?.generatedAt
      ? {
          generatedAt: meeting.aiSummary.generatedAt,
          language: meeting.aiSummary.language,
        }
      : null,
    aiParticipantNotesCount: Array.isArray(meeting.aiParticipantNotes)
      ? meeting.aiParticipantNotes.length
      : 0,
  }
}

async function emitMeetingUpdates(database, meetingIds, action = 'background-finalize') {
  if (!global.io || meetingIds.length === 0) {
    return
  }

  const meetings = await Promise.all([...(await readFirestoreReferences(database, 'meetings', meetingIds)).values()].map(row => populateMeeting(database, row)))

  for (const meeting of meetings) {
    const targetUserIds = getMeetingTargetUserIds(meeting)
    if (targetUserIds.length === 0) {
      continue
    }

    emitMeetingUpdate(buildMeetingRealtimePayload(meeting), targetUserIds, { action })
  }
}

async function withDatabaseLock(databaseName, fn) {
  if (finalizerState.databases.has(databaseName)) {
    return {
      success: true,
      skipped: true,
      databaseName,
      message: 'Meeting finalizer is already processing this tenant',
      meetingsCompleted: 0,
      linksDeactivated: 0,
      summariesGenerated: 0,
      summaryFailures: [],
      meetingsTouched: 0,
    }
  }

  finalizerState.databases.add(databaseName)

  try {
    return await fn()
  } finally {
    finalizerState.databases.delete(databaseName)
  }
}

export async function inspectExpiredMeetingsForDatabase(databaseName, options = {}) {
  const database = await getMeetingDatabase(databaseName)
  const now = options.now || new Date()

  const expired = await database.count('meetings', [eq('scheduledEnd', now, '<'), eq('status', ['scheduled', 'rescheduled'], 'in')])
  const inProgress = await database.count('meetings', [eq('status', 'in-progress')])
  const expiredMeetingsPending = expired + inProgress
  const expiredMeetingsWithActiveLinks = await database.count('meetings', [eq('type', 'online'), eq('isLinkActive', true), eq('scheduledEnd', now, '<')])
  const summaryGenerationPending = await database.count('meetings', summaryFilters(now))

  return {
    expiredMeetingsPending,
    expiredMeetingsWithActiveLinks,
    summaryGenerationPending,
  }
}

export async function processExpiredMeetingsForDatabase(databaseName, options = {}) {
  return withDatabaseLock(databaseName, async () => {
    const now = options.now || new Date()
    const database = await getMeetingDatabase(databaseName)

    const result = {
      success: true,
      skipped: false,
      databaseName,
      tenantName: options.tenantName || databaseName,
      meetingsCompleted: 0,
      linksDeactivated: 0,
      summariesGenerated: 0,
      summaryFailures: [],
      meetingsTouched: 0,
    }

    const touchedMeetingIds = new Set()

    const expiredRows = await collectFirestorePages(database, 'meetings', { filters: [eq('scheduledEnd', now, '<'), eq('status', ['scheduled', 'rescheduled', 'in-progress'], 'in')] })
    const occupiedRows = await collectFirestorePages(database, 'meetings', { filters: [eq('type', 'online'), eq('status', 'in-progress')] })
    const expiredMeetings = [...new Map([...expiredRows, ...occupiedRows].map(row => [row._id, row])).values()]

    for (const meeting of expiredMeetings) {
      if (meeting.type === 'online') {
        try {
          const refreshed = await refreshMeetingAvailability(database, meeting, databaseName, now)
          if (refreshed.status === 'completed') { result.meetingsCompleted += 1; result.linksDeactivated += 1 }
          touchedMeetingIds.add(meeting._id.toString())
        } catch (error) { console.warn('[Meeting Finalizer] Presence unavailable; keeping meeting open:', meeting._id.toString()) }
        continue
      }
      const updates = {
        status: 'completed',
      }

      if (meeting.type === 'online' && meeting.isLinkActive) {
        updates.isLinkActive = false
        result.linksDeactivated += 1
      }

      if (!meeting.actualEnd) {
        updates.actualEnd = meeting.scheduledEnd || now
      }

      await database.mutate('meetings', String(meeting._id), current => current && current.status === meeting.status ? { ...current, ...updates } : current)
      result.meetingsCompleted += 1
      touchedMeetingIds.add(meeting._id.toString())
    }

    const completedWithActiveLinks = await collectFirestorePages(database, 'meetings', { filters: [eq('type', 'online'), eq('status', 'completed'), eq('isLinkActive', true), eq('scheduledEnd', now, '<')] })
    for (const meeting of completedWithActiveLinks) {
      await database.mutate('meetings', meeting._id, current => current?.status === 'completed' ? { ...current, isLinkActive: false } : current)
      result.linksDeactivated++
      touchedMeetingIds.add(meeting._id)
    }
    const meetingsNeedingInsights = await Promise.all((await collectFirestorePages(database, 'meetings', { filters: summaryFilters(now) })).map(row => populateMeeting(database, row)))

    for (const meeting of meetingsNeedingInsights) {
      if (!hasMeetingInsightSource(meeting)) {
        continue
      }

      try {
        const insights = await generateMeetingInsights(meeting)

        const persistedInsights = await persistMeetingInsights(database, meeting, insights, {
          sourceUpdatedAt: meeting.updatedAt,
          replaceLatestHistory: Boolean(meeting?.aiSummary?.generatedAt || meeting?.aiSummary?.history?.length),
        })

        try {
          await sendMeetingMinutesEmails(database, {
            ...(meeting?.toObject ? meeting.toObject() : meeting),
            aiSummary: persistedInsights.aiSummary,
            aiParticipantNotes: persistedInsights.aiParticipantNotes,
          }, {
            sourceUpdatedAt: persistedInsights.aiSummary?.sourceUpdatedAt || meeting.updatedAt,
          })
        } catch (emailError) {
          console.error(`[Meeting Finalizer] Failed to send MOM emails for ${databaseName}/${meeting._id}:`, emailError)
        }

        result.summariesGenerated += 1
        touchedMeetingIds.add(meeting._id.toString())
      } catch (error) {
        result.summaryFailures.push({
          meetingId: meeting._id.toString(),
          title: meeting.title,
          error: error.message,
        })
        console.error(`[Meeting Finalizer] Failed to generate summary for ${databaseName}/${meeting._id}:`, error)
      }
    }

    result.meetingsTouched = touchedMeetingIds.size

    if (touchedMeetingIds.size > 0) {
      await emitMeetingUpdates(database, Array.from(touchedMeetingIds), options.action)
    }

    return result
  })
}

export async function processExpiredMeetingsAcrossTenants(options = {}) {
  if (finalizerState.allTenantsRunning) {
    return {
      success: true,
      skipped: true,
      message: 'Meeting finalizer is already running',
      tenantsProcessed: 0,
      tenantsFailed: 0,
      meetingsCompleted: 0,
      linksDeactivated: 0,
      summariesGenerated: 0,
      summaryFailures: 0,
      tenantErrors: [],
    }
  }

  finalizerState.allTenantsRunning = true

  try {
    const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive', 'serviceStatus'] } })
    const tenants = (await collectFirestorePages(system, 'tenantcompanies', { filters: [eq('isActive', true), eq('serviceStatus', 'active')] })).filter(tenant => tenant.databaseName && tenant.features?.meetings !== false)

    const aggregate = {
      success: true,
      skipped: false,
      tenantsProcessed: 0,
      tenantsFailed: 0,
      meetingsCompleted: 0,
      linksDeactivated: 0,
      summariesGenerated: 0,
      summaryFailures: 0,
      tenantErrors: [],
    }

    for (const tenant of tenants) {
      try {
        const result = await processExpiredMeetingsForDatabase(tenant.databaseName, {
          tenantName: tenant.name,
          action: options.action || 'background-finalize',
        })

        if (!result.skipped) {
          aggregate.tenantsProcessed += 1
        }

        aggregate.meetingsCompleted += result.meetingsCompleted
        aggregate.linksDeactivated += result.linksDeactivated
        aggregate.summariesGenerated += result.summariesGenerated
        aggregate.summaryFailures += result.summaryFailures.length
      } catch (error) {
        aggregate.success = false
        aggregate.tenantsFailed += 1
        aggregate.tenantErrors.push({
          tenantName: tenant.name,
          databaseName: tenant.databaseName,
          error: error.message,
        })
        console.error(`[Meeting Finalizer] Tenant processing failed for ${tenant.databaseName}:`, error)
      }
    }

    return aggregate
  } finally {
    finalizerState.allTenantsRunning = false
  }
}
