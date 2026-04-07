import mongoose from 'mongoose'
import { connectSuperadminDB } from './superadminDb.js'
import { getTenantModels } from './tenantModels.js'
import {
  generateMeetingInsights,
  hasMeetingInsightSource,
  persistMeetingInsights,
} from './meetingAI.js'
import { emitMeetingUpdate } from './realtimeEvents.js'

const EPOCH_DATE = new Date(0)

const finalizerState = globalThis.__meetingFinalizerState || {
  allTenantsRunning: false,
  databases: new Set(),
}

if (!globalThis.__meetingFinalizerState) {
  globalThis.__meetingFinalizerState = finalizerState
}

const TenantCompanyMiniSchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: String,
  isActive: Boolean,
  serviceStatus: String,
  features: {
    meetings: {
      type: Boolean,
      default: true,
    },
  },
}, {
  strict: false,
  collection: 'tenantcompanies',
})

let tenantCompanyModel = null
let tenantCompanyConnection = null

async function getTenantCompanyModelForFinalizer() {
  const connection = await connectSuperadminDB()

  if (tenantCompanyModel && tenantCompanyConnection === connection && connection.readyState === 1) {
    return tenantCompanyModel
  }

  tenantCompanyModel = connection.models.TenantCompany
    || connection.model('TenantCompany', TenantCompanyMiniSchema)
  tenantCompanyConnection = connection

  return tenantCompanyModel
}

function getMeetingSummaryCandidateQuery(now) {
  return {
    scheduledEnd: { $lt: now },
    status: 'completed',
    $or: [
      { 'transcript.0': { $exists: true } },
      { 'mom.0': { $exists: true } },
      { notes: { $regex: /\S/ } },
    ],
    $expr: {
      $gt: [
        '$updatedAt',
        { $ifNull: ['$aiSummary.sourceUpdatedAt', EPOCH_DATE] },
      ],
    },
  }
}

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

async function emitMeetingUpdates(Meeting, meetingIds, action = 'background-finalize') {
  if (!global.io || meetingIds.length === 0) {
    return
  }

  const meetings = await Meeting.find({ _id: { $in: meetingIds } })
    .select('title type roomId scheduledStart scheduledEnd actualEnd status isLinkActive aiSummary aiParticipantNotes organizer invitees')
    .populate('organizer', 'firstName lastName userId')
    .populate('invitees.employee', 'firstName lastName userId')
    .lean()

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
  const { Meeting } = await getTenantModels(databaseName, ['Meeting'])
  const now = options.now || new Date()

  const [expiredMeetingsPending, expiredMeetingsWithActiveLinks, summaryGenerationPending] = await Promise.all([
    Meeting.countDocuments({
      scheduledEnd: { $lt: now },
      status: { $in: ['scheduled', 'in-progress'] },
    }),
    Meeting.countDocuments({
      type: 'online',
      isLinkActive: true,
      scheduledEnd: { $lt: now },
    }),
    Meeting.countDocuments(getMeetingSummaryCandidateQuery(now)),
  ])

  return {
    expiredMeetingsPending,
    expiredMeetingsWithActiveLinks,
    summaryGenerationPending,
  }
}

export async function processExpiredMeetingsForDatabase(databaseName, options = {}) {
  return withDatabaseLock(databaseName, async () => {
    const now = options.now || new Date()
    const { Meeting } = await getTenantModels(databaseName, ['Meeting'])

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

    const expiredMeetings = await Meeting.find({
      scheduledEnd: { $lt: now },
      status: { $in: ['scheduled', 'in-progress'] },
    })
      .select('title type status scheduledEnd actualEnd isLinkActive')
      .lean()

    for (const meeting of expiredMeetings) {
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

      await Meeting.updateOne(
        { _id: meeting._id },
        { $set: updates },
        { timestamps: false }
      )
      result.meetingsCompleted += 1
      touchedMeetingIds.add(meeting._id.toString())
    }

    const completedWithActiveLinks = await Meeting.find({
      type: 'online',
      status: 'completed',
      isLinkActive: true,
      scheduledEnd: { $lt: now },
    })
      .select('_id')
      .lean()

    if (completedWithActiveLinks.length > 0) {
      await Meeting.updateMany(
        {
          _id: { $in: completedWithActiveLinks.map(meeting => meeting._id) },
        },
        {
          $set: { isLinkActive: false },
        },
        { timestamps: false }
      )

      result.linksDeactivated += completedWithActiveLinks.length
      completedWithActiveLinks.forEach(meeting => touchedMeetingIds.add(meeting._id.toString()))
    }

    const meetingsNeedingInsights = await Meeting.find(getMeetingSummaryCandidateQuery(now))
      .populate('organizer', 'firstName lastName email userId profilePicture')
      .populate('invitees.employee', 'firstName lastName email userId profilePicture department')

    for (const meeting of meetingsNeedingInsights) {
      if (!hasMeetingInsightSource(meeting)) {
        continue
      }

      try {
        const insights = await generateMeetingInsights(meeting, { language: 'auto' })

        await persistMeetingInsights(Meeting, meeting, insights, {
          sourceUpdatedAt: meeting.updatedAt,
        })

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
      await emitMeetingUpdates(Meeting, Array.from(touchedMeetingIds), options.action)
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
    const TenantCompany = await getTenantCompanyModelForFinalizer()
    const tenants = await TenantCompany.find({
      isActive: true,
      serviceStatus: 'active',
      databaseName: { $exists: true, $ne: null },
      $or: [
        { 'features.meetings': { $exists: false } },
        { 'features.meetings': true },
      ],
    })
      .select('name slug databaseName')
      .lean()

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