/**
 * Cache Warming Module
 * 
 * Pre-populates Redis cache for dashboard APIs after login or validate.
 * This ensures dashboard loads are fast (cache hits) instead of slow (cold DB queries).
 * 
 * Two modes:
 * - **blocking** (validate): Awaits warming before returning. The browser fires dashboard
 *   APIs AFTER validate returns, so all APIs hit warm cache. Total page load is faster
 *   even though validate takes longer: validate(3-5s) + instant APIs vs validate(500ms) + slow APIs(10-15s).
 * - **fire-and-forget** (login): Warming runs in background during the login→dashboard redirect.
 * 
 * Deduplication: Won't re-warm if the same user was warmed within the last 60 seconds.
 */

const INTERNAL_BASE = process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || `http://localhost:${process.env.PORT || 3000}`

// Track recent warm operations to avoid redundant work
// Key: userId, Value: timestamp of last warm
if (!global.__cacheWarmTracker) {
    global.__cacheWarmTracker = new Map()
}
const WARM_COOLDOWN_MS = 60 * 1000 // Don't re-warm same user within 60s

/**
 * Warm all dashboard-related caches for a user.
 * 
 * @param {Object} options
 * @param {string} options.token - JWT token for the authenticated user
 * @param {string} options.role - User role (admin, hr, manager, employee, etc.)
 * @param {string} options.employeeId - Employee ID string
 * @param {string} options.userId - User ID string
 * @param {boolean} [options.blocking=false] - If true, awaits warming (with timeout). Use for validate.
 * @param {number} [options.maxWaitMs=10000] - Max ms to block when blocking=true
 */
export async function warmDashboardCaches({ token, role, employeeId, userId, blocking = false, maxWaitMs = 10000 }) {
    if (!token || !userId) return

    // Deduplication — skip if we recently warmed for this user
    const lastWarm = global.__cacheWarmTracker.get(userId)
    if (lastWarm && (Date.now() - lastWarm) < WARM_COOLDOWN_MS) {
        return // Already warmed recently, skip
    }
    global.__cacheWarmTracker.set(userId, Date.now())

    // Cleanup old entries (prevent memory leak)
    if (global.__cacheWarmTracker.size > 200) {
        const now = Date.now()
        for (const [key, ts] of global.__cacheWarmTracker) {
            if (now - ts > WARM_COOLDOWN_MS * 5) global.__cacheWarmTracker.delete(key)
        }
    }

    // Start the warming work
    const warmPromise = _doWarm({ token, role, employeeId, userId })

    if (blocking) {
        // Await warming with a safety timeout — don't block forever
        console.log(`[CacheWarming] ⏳ Blocking validate for up to ${maxWaitMs}ms while caches warm...`)
        await Promise.race([
            warmPromise,
            new Promise(resolve => setTimeout(resolve, maxWaitMs)),
        ])
        // If timeout hit, warmPromise continues in background — no harm done
    }
    // Non-blocking: warmPromise runs in background, caller doesn't await
}

/**
 * Internal: Fire HTTP requests to all dashboard API endpoints to populate their caches.
 */
async function _doWarm({ token, role, employeeId, userId }) {
    console.log(`[CacheWarming] 🔥 Starting cache warm for user ${userId} (${role})`)
    const startTime = Date.now()

    // Determine which stats endpoint to hit based on role
    let statsEndpoint = '/api/dashboard/employee-stats'
    if (['admin', 'department_head', 'hr'].includes(role)) {
        statsEndpoint = '/api/dashboard/hr-stats'
    } else if (role === 'manager') {
        statsEndpoint = '/api/dashboard/manager-stats'
    }

    // Today's date for task/attendance queries
    const today = new Date().toISOString().split('T')[0]

    // All dashboard API endpoints to warm
    // NOTE: /api/sidebar/counts and /api/chat/unread are excluded — these are now
    // event-driven via Socket.IO push (sidebar.counts.updated / chat.unread.updated).
    // Warming them would be wasted work since the client refreshes on socket events.
    const endpoints = [
        '/api/settings/company',
        '/api/team/check-head',
        ...(employeeId ? [`/api/employees/${employeeId}`] : []),
        '/api/actionable-notifications',
        statsEndpoint,
        '/api/dashboard/unified',
        '/api/dashboard/role-news?fresh=true',
        '/api/profile/completion-status',
        `/api/tasks?view=personal&dueDate=${today}&limit=5`,
        `/api/projects/my-tasks?period=today&limit=5`,
    ]

    const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Cache-Warm': 'true', // Marker header for log identification
    }

    // Fire all requests in parallel
    const promises = endpoints.map(async (endpoint) => {
        try {
            const url = `${INTERNAL_BASE}${endpoint}`
            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(30000), // 30s max per request
            })
            return { endpoint, status: response.status }
        } catch (error) {
            // Warming failures are non-critical
            return { endpoint, error: error.message }
        }
    })

    // Wait for all and log summary
    const results = await Promise.allSettled(promises)
    const duration = Date.now() - startTime
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value?.status === 200).length
    const total = results.length
    console.log(`[CacheWarming] ✅ Warmed ${succeeded}/${total} caches in ${duration}ms for user ${userId}`)
}
