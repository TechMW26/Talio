import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getRuntimeCapabilities, getVercelReadiness } from '@/lib/platform/runtime'
import connectDB from '@/lib/mongodb'

// Health check endpoint for Docker and monitoring
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
  }

  // Quick health check for Docker (no detailed checks)
  if (!detailed) {
    return NextResponse.json(health)
  }

  // Detailed health check for monitoring dashboards
  try {
    // Check MongoDB connection
    await connectDB()
    await mongoose.connection.db.admin().ping()
    const mongoState = mongoose.connection.readyState
    health.mongodb = {
      connected: mongoState === 1,
      state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown'
    }

    // Check Redis if available
    try {
      const { getCache, setCache, getRedisInfo } = await import('@/lib/cache')
      const testKey = `health:${Date.now()}`
      await setCache(testKey, 'ok', 5)
      const result = await getCache(testKey)
      const info = await getRedisInfo()
      health.cache = {
        available: result === 'ok',
        type: info.connected ? 'redis' : 'memory',
        connected: info.connected,
        host: info.host,
        connectedAt: info.connectedAt,
        lastError: info.lastError,
        ...(info.serverInfo ? { serverInfo: info.serverInfo } : {}),
      }
    } catch {
      health.cache = { available: false, type: 'none' }
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
    if (!health.mongodb?.connected) {
      health.status = 'degraded'
    }

  } catch (error) {
    health.status = 'error'
    health.error = error.message
  }

  const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503
  return NextResponse.json(health, { status: statusCode })
}
