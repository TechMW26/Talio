# Talio — AI Coding Instructions

Production multi-tenant HRMS: **Next.js 15 App Router + custom Node server (`server.js`) + MongoDB + Socket.IO**. Tenant isolation is non-negotiable. Always use `npm run dev` (runs `server.js`), **never** `next dev`.

---

## Architecture overview

- **Central DB** (`talio_superadmin`): TenantCompany, UserTenantMapping, SuperAdmin
- **Tenant DBs** (`talio_company_{slug}`): User, Employee, Attendance, Leave, Task, Project, etc.
- **Custom server** (`server.js`): wraps Next.js with Socket.IO at `/api/socketio`; exposes `global.io` for API routes
- **Middleware** (`middleware.js`): whitelist-based auth guard — add new public routes to `publicRoutes`/`publicApiRoutes` arrays
- **User ≠ Employee**: User = auth record (email, password, role, JWT); Employee = HR profile (name, dept, salary). Linked via `User.employeeId → Employee._id`. Some users have no Employee record.
- **Roles**: `admin`, `hr`, `manager`, `employee`, `department_head`
- **SuperAdmin**: cross-tenant, uses `lib/superadminAuth.js::verifySuperAdmin(request)` with `isSuperAdmin` JWT flag; routes under `/superadmin/*` and `/api/superadmin/*` bypass tenant middleware

---

## API route pattern (follow exactly)

Every tenant API route in `app/api/**/route.js` must follow this structure:

```javascript
import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitTaskUpdate, emitDashboardRefresh } from '@/lib/realtimeEvents'

export async function POST(request) {
  try {
    // 1. Auth + tenant-scoped models (REQUIRED first step)
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Task'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Task } = models

    // 2. Parse input & validate
    const body = await request.json()
    if (!body.title) {
      return NextResponse.json({ success: false, message: 'Title is required' }, { status: 400 })
    }

    // 3. DB operations (use .lean(), .select(), .populate() for performance)
    const task = await Task.create({ ...body, createdBy: user._id })

    // 4. Emit real-time event (use helpers from lib/realtimeEvents.js)
    emitTaskUpdate({ action: 'created', task, assignedTo: body.assignedTo })
    emitDashboardRefresh({ reason: 'task-created' })

    // 5. Response envelope
    return NextResponse.json({ success: true, data: task }, { status: 201 })
  } catch (error) {
    console.error('Task creation error:', error)
    return NextResponse.json({ success: false, message: 'Failed to create task' }, { status: 500 })
  }
}
```

**Critical rules:**
- ❌ Never `import User from '@/models/User'` — models MUST come from `getAuthAndModels()` or `getTenantModels(databaseName)`
- ✅ Response envelope: `{ success: boolean, data?, message?, pagination?: { page, limit, total, pages } }`
- Status codes: `200` (success), `201` (created), `400` (bad input), `401` (auth), `404` (not found), `500` (server)
- Fire-and-forget side effects (email, backup) via `.then()` — don't await non-critical ops

---

## Two caching layers

### 1. Redis + memory fallback (`lib/cache.js`) — for auth & cross-request data
```javascript
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
const key = buildCacheKey({ tenantId: user.databaseName, role: 'any', userId: user._id, namespace: 'attendance:today' })
const cached = await getCache(key)
if (cached) return cached
// ... query DB ...
await setCache(key, result, 300) // TTL in seconds
```

### 2. In-process query cache (`lib/queryCache.js`) — for per-process GET caching
```javascript
import queryCache from '@/lib/queryCache'
const cacheKey = queryCache.generateKey('employees', page, department)
const cached = queryCache.get(cacheKey)
if (cached) return NextResponse.json(cached)
// ... query DB ...
queryCache.set(cacheKey, response, 30000) // TTL in ms
// Clear on mutation: queryCache.clearPattern('employees')
```

**TTL guidelines**: auth 5min, dashboard stats 10–30s, list queries 5–10min. **Never cache**: geofence checks, approval mutations, status updates.

---

## Real-time events (Socket.IO)

- **Event names**: centralized in `lib/realtimeEvents.js` as `REALTIME_EVENTS` constant (~45 events)
- **Emission helpers**: `emitTaskUpdate()`, `emitLeaveUpdate()`, `emitEmployeeUpdate()`, `emitDashboardRefresh()`, etc. — prefer these over raw `global.io.emit()`
- **Room format**: `user:${User._id}` (NOT employeeId)
- **Frontend subscriptions**: `contexts/SocketContext.js` exposes `onTaskUpdated()`, `onLeaveUpdate()`, etc. — each returns a cleanup function for `useEffect`
- **Presence**: tracked via `presenceByEmployee` Map in `server.js`; clients emit `presence-update`

---

## Frontend data fetching (SWR)

Three hook tiers in `hooks/useAuthedSWR.js`:
- **`useAuthedSWR(key)`** — default: revalidateOnFocus off, dedupe 10s
- **`useStaticSWR(key)`** — for rarely-changing data (departments, designations): dedupe 5min, revalidateOnMount only
- **`useRealtimeSWR(key)`** — for live data (notifications, chat): refreshInterval 30s, revalidateOnFocus on

All auto-inject Bearer token from localStorage and handle 401 → redirect to `/login`.

---

## Notifications

Dual delivery via `lib/notificationService.js`:
1. **FCM push** (Firebase Cloud Messaging) via `lib/fcmHelper.js`
2. **MongoDB `Notification` document** per user (with `read`/`readAt` tracking)

Use domain helpers: `sendLeaveNotification()`, `sendTaskNotification()`, `sendAttendanceNotification()`, etc. Each accepts `{ tenantModels }` for multi-tenant context.

---

## New feature checklist

1. **Schema**: add to `lib/tenantModels.js` (single file contains ALL tenant schemas)
2. **API route**: `app/api/{feature}/route.js` with `getAuthAndModels()` pattern above
3. **Real-time**: add event to `REALTIME_EVENTS` in `lib/realtimeEvents.js`, add emit helper, add subscription method in `contexts/SocketContext.js`
4. **Frontend**: dashboard page at `app/dashboard/{feature}/page.js`, use `useAuthedSWR` + socket listener
5. **Notifications**: add helper in `lib/notificationService.js` if user-facing
6. **Middleware**: add to `publicApiRoutes` in `middleware.js` only if unauthenticated access needed
7. **Role guard**: use `hasRole(user, ['admin', 'hr'])` in API, `<RoleBasedAccess requiredRoles={['admin']}>` in frontend

---

## Commands

```bash
npm run dev       # Custom server + Socket.IO (REQUIRED — never next dev)
npm run build     # SKIP_ENV_VALIDATION=true next build
npm run start     # Production server
npm run seed      # Seed initial data
```

Migrations: `node scripts/migrate-*.js`. Cleanup: `node scripts/cleanup-*.js`.

---

## Key gotchas

- **No browser HTTP caching**: `next.config.js` forces `Cache-Control: no-store` on all routes — rely on SWR + Redis/memory instead
- **12GB Node heap**: dev script sets `--max-old-space-size=12288`
- **Build ignores errors**: ESLint + TypeScript errors are non-blocking in `next build` (configured in `next.config.js`)
- **Socket rooms use `user._id`**, never `employeeId` — consistent with notification storage
- **Schemas use `strict: false`**: models accept additional fields beyond schema definition
- **JWT must contain `databaseName`**: tokens without it are rejected — no fallback DB exists
- **Google Maps keys**: backend-only, never exposed in frontend (`docs/GOOGLE_MAPS_SETUP.md`)

---

## Key files reference

| Concern | Files |
|---------|-------|
| Auth | `lib/auth.js` (getAuthAndModels), `lib/superadminAuth.js` |
| Models | `lib/tenantModels.js` (all schemas), `lib/tenantDb.js` (connections) |
| Real-time | `lib/realtimeEvents.js`, `server.js`, `contexts/SocketContext.js` |
| Caching | `lib/cache.js` (Redis), `lib/queryCache.js` (in-process) |
| Notifications | `lib/notificationService.js`, `lib/fcmHelper.js` |
| AI/LLM | `lib/gemini.js` (primary), OpenAI (fallback), `lib/vectorSearch.js` |
| Frontend hooks | `hooks/useAuthedSWR.js`, `hooks/useAutoRefresh.js` |
| Middleware | `middleware.js` (route guards + public route whitelists) |
