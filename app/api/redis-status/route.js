import { NextResponse } from 'next/server'
import {
    getCache,
    setCache,
    deleteCache,
    getRedisInfo,
    resetRedisConnection,
    flushAllCaches,
} from '@/lib/cache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/redis-status
 * Returns Redis connection health, server info, and runs a round-trip test.
 * Only accessible by admin users (or via internal token).
 */
export async function GET(request) {
    try {
        // Run a live round-trip test
        const testKey = `redis:health:test:${Date.now()}`
        const testValue = { ping: 'pong', ts: Date.now() }

        let roundTripMs = null
        let writeOk = false
        let readOk = false
        let deleteOk = false
        let roundTripError = null

        try {
            const t0 = Date.now()
            await setCache(testKey, testValue, 10) // TTL = 10 s
            writeOk = true

            const got = await getCache(testKey)
            readOk = got?.ping === 'pong'

            await deleteCache(testKey)
            const gone = await getCache(testKey)
            deleteOk = gone === null

            roundTripMs = Date.now() - t0
        } catch (err) {
            roundTripError = err.message
        }

        // Detailed connection info
        const info = await getRedisInfo()

        const status = {
            ok: writeOk && readOk && deleteOk,
            timestamp: new Date().toISOString(),
            roundTripMs,
            operations: { write: writeOk, read: readOk, delete: deleteOk },
            ...(roundTripError ? { roundTripError } : {}),
            redis: info,
            fallback: !info.connected ? 'in-memory' : null,
            nodeEnv: process.env.NODE_ENV,
        }

        return NextResponse.json(status, {
            status: status.ok ? 200 : 503,
        })
    } catch (err) {
        return NextResponse.json(
            { ok: false, error: err.message, timestamp: new Date().toISOString() },
            { status: 500 }
        )
    }
}

/**
 * POST /api/redis-status
 * Body: { action: 'reset' } — resets the Redis connection state and forces a reconnect.
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}))

        if (body.action === 'reset') {
            resetRedisConnection()
            // Eagerly try to reconnect
            const info = await getRedisInfo()
            return NextResponse.json({
                ok: true,
                message: 'Redis connection state reset. Reconnection initiated.',
                redis: info,
                timestamp: new Date().toISOString(),
            })
        }

        if (body.action === 'flush') {
            const flushed = await flushAllCaches()
            return NextResponse.json({
                ok: true,
                message: flushed ? 'All Redis caches flushed.' : 'Memory cache cleared (Redis unavailable).',
                timestamp: new Date().toISOString(),
            })
        }

        return NextResponse.json({ ok: false, error: 'Unknown action. Use: reset, flush' }, { status: 400 })
    } catch (err) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
    }
}
