import { buildCachePattern, clearCachePattern } from './cache.js'

export async function refreshAffectedUsers({
  databaseName,
  userIds,
  initiatedBy = null,
  message,
  forceRefreshModel = null,
}) {
  const uniqueUserIds = [...new Set((userIds || []).map((userId) => userId?.toString()).filter(Boolean))]

  if (!databaseName || uniqueUserIds.length === 0) {
    return { affectedUserIds: [], queuedCount: 0 }
  }

  await Promise.all([
    ...uniqueUserIds.flatMap((userId) => [
      clearCachePattern(buildCachePattern({ tenantId: databaseName, namespace: 'auth:user', userId })).catch(() => { }),
      clearCachePattern(buildCachePattern({ tenantId: databaseName, namespace: 'profile', userId })).catch(() => { }),
      clearCachePattern(buildCachePattern({ tenantId: databaseName, namespace: 'dashboard:employee-stats', userId })).catch(() => { }),
    ]),
    clearCachePattern(buildCachePattern({ tenantId: databaseName, namespace: 'dashboard:manager-stats', userId: '*' })).catch(() => { }),
    clearCachePattern(buildCachePattern({ tenantId: databaseName, namespace: 'dashboard:hr-stats', userId: '*' })).catch(() => { }),
  ])

  const refreshPayload = {
    type: 'force-refresh',
    message: message || 'Your role permissions were updated. Talio will refresh to apply the latest access.',
    initiatedBy,
    timestamp: new Date().toISOString(),
    hard: true,
  }

  let fallbackUserIds = uniqueUserIds

  if (global.io) {
    fallbackUserIds = []
    for (const userId of uniqueUserIds) {
      const room = global.io.sockets?.adapter?.rooms?.get(`user:${userId}`)
      const hasActiveSocket = Boolean(room && room.size > 0)
      global.io.to(`user:${userId}`).emit('force-refresh', refreshPayload)
      if (!hasActiveSocket) {
        fallbackUserIds.push(userId)
      }
    }
  }

  if (forceRefreshModel && fallbackUserIds.length > 0) {
    try {
      await forceRefreshModel.insertMany(
        fallbackUserIds.map((userId) => ({
          userId,
          message: refreshPayload.message,
          hard: refreshPayload.hard,
          initiatedBy: refreshPayload.initiatedBy,
          consumed: false,
        }))
      )
    } catch (error) {
      console.warn('[RBAC] Failed to queue force-refresh records:', error.message)
    }
  }

  return {
    affectedUserIds: uniqueUserIds,
    queuedCount: fallbackUserIds.length,
  }
}