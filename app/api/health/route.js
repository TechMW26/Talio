import { NextResponse } from 'next/server'
import mongoose from 'mongoose'

// Health check endpoint for Docker and monitoring
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const detailed = searchParams.get('detailed') === 'true'
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }
  
  // Quick health check for Docker (no detailed checks)
  if (!detailed) {
    return NextResponse.json(health)
  }
  
  // Detailed health check for monitoring dashboards
  try {
    // Check MongoDB connection
    const mongoState = mongoose.connection.readyState
    health.mongodb = {
      connected: mongoState === 1,
      state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown'
    }
    
    // Check Redis if available
    try {
      const { getCache, setCache } = await import('@/lib/cache')
      const testKey = `health:${Date.now()}`
      await setCache(testKey, 'ok', 5)
      const result = await getCache(testKey)
      health.cache = { available: result === 'ok', type: process.env.REDIS_URL ? 'redis' : 'memory' }
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
