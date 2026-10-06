import { NextResponse } from 'next/server'
import { getRuntimeCapabilities, getVercelReadiness } from '@/lib/platform/runtime'

// Lightweight liveness endpoint; detailed checks verify managed services.
export async function HEAD() {
  return new Response(null, { status: 200 })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const detailed = searchParams.get('detailed') === 'true'

  const runtime = getRuntimeCapabilities()
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: runtime.runtime,
    deployment: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || null,
    instanceUptimeSeconds: Math.round(process.uptime()),
    // Client boot must not contact a deliberately disabled provider. This
    // capability check is configuration-only: no database or Redis reads.
    capabilities: { managedRealtime: runtime.managedRealtime },
  }

  // Quick health check (no detailed checks)
  if (!detailed) {
    return NextResponse.json(health)
  }

  // Detailed health check for monitoring dashboards
  try {
    const { getFirestoreProvisioningContext } = await import('@/lib/platform/firestoreApplication.server')
    // An uncached read verifies the configured native data plane, not merely
    // that credentials or a cached tenant catalog exist.
    const { firestore, dataset } = await getFirestoreProvisioningContext()
    const snapshot = await firestore.collection('talioDatasets').doc(dataset).get()
    health.firestore = { connected: snapshot.exists }

    // Check Redis if available
    try {
      const { probeRedis, getRedisInfo } = await import('@/lib/cache')
      const [available, info] = await Promise.all([probeRedis(), getRedisInfo()])
      health.cache = {
        available,
        type: info.connected ? 'redis' : 'memory',
        connected: info.connected,
        connectedAt: info.connectedAt,
      }
      if (runtime.distributedCache && !available) health.status = 'degraded'
    } catch {
      health.cache = { available: false, type: 'none' }
      if (runtime.distributedCache) health.status = 'degraded'
    }

    // Memory usage
    const memUsage = process.memoryUsage()
    health.memory = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
    }

    health.capabilities = {
      blobStorage: runtime.blobStorage,
      distributedCache: runtime.distributedCache,
      managedRealtime: runtime.managedRealtime,
      managedMeetings: runtime.managedMeetings,
      durableQueue: runtime.durableQueue,
      persistentFilesystem: runtime.persistentFilesystem,
      persistentProcess: runtime.persistentProcess,
    }

    if (runtime.isVercel) {
      const readiness = getVercelReadiness()
      health.vercel = {
        ready: readiness.ready,
        missingCapabilities: readiness.missing.map((item) => item.capability),
        invalidCapabilities: readiness.invalid.map((item) => item.capability),
      }
      if (!readiness.ready) health.status = 'degraded'
    }

    // Check if all critical services are healthy
    if (!health.firestore?.connected) {
      health.status = 'degraded'
    }

  } catch (error) {
    health.status = 'error'
    health.error = 'Managed database health check failed'
  }

  const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503
  return NextResponse.json(health, { status: statusCode })
}
