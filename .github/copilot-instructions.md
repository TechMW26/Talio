# Talio (web) — Copilot Instructions

## Architecture overview
- **Next.js 15 App Router** with API routes in `app/api/**/route.js`
- **Custom server required**: run via `node server.js` (wrapped by `npm run dev`), **not** `next dev` — Socket.IO requires this for `global.io`
- **Multi-tenant MongoDB**: each company has isolated DB (`talio_company_{slug}`). JWT tokens **must** contain `databaseName`; no fallback exists

### Database structure
```
talio_superadmin (central)     →  TenantCompany, UserTenantMapping, SuperAdmin
talio_company_{slug} (tenant)  →  User, Employee, Attendance, Project, Task... (40+ models)
```

## Critical API pattern (multi-tenant)
**Always** use `getAuthAndModels()` for authenticated routes — never import from `/models/*` directly:

```javascript
// ✅ CORRECT - tenant-aware
import { getAuthAndModels } from '@/lib/auth'
export async function POST(request) {
  const auth = await getAuthAndModels(request, ['Employee', 'Attendance', 'User'])
  if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 })
  const { user, models } = auth
  const employees = await models.Employee.find({ department: user.employeeId.department })
}

// ❌ WRONG - bypasses tenant isolation
import Employee from '@/models/Employee'
```

See `app/api/attendance/geolocation-check/route.js` for complete example.

## Real-time events (Socket.IO)
- Path: `/api/socketio` (configured in `server.js`)
- Event constants: import from `lib/realtimeEvents.js` (also mirrored in `contexts/SocketContext.js` for client)
- **Always guard** socket emissions in API routes:
```javascript
if (global.io) global.io.to(`user:${userId}`).emit('task-updated', payload)
```
- Socket auth uses `User._id` (not `employeeId`) — see `contexts/SocketContext.js`

## Auth & middleware
- Route protection in `middleware.js`: allowlists in `publicRoutes` / `publicApiRoutes`
- `/superadmin` and `/api/superadmin` bypass middleware (use `lib/superadminAuth.js` internally)
- Roles: `admin`, `hr`, `manager`, `employee`, `department_head`
- Role-based UI: wrap with `<RoleBasedAccess requiredRoles={['admin','hr']}>` (see `components/RoleBasedAccess.js`)

## Key lib modules
| Module | Purpose |
|--------|---------|
| `lib/auth.js` | `getAuthAndModels()`, `verifyTokenFromRequest()` |
| `lib/tenantModels.js` | Schema definitions + `getTenantModels()` for tenant-bound queries |
| `lib/realtimeEvents.js` | Socket event constants + `emitToUsers()` helper |
| `lib/pushNotification.js` | Firebase push to mobile/web |
| `lib/gemini.js` | AI calls (Gemini primary, OpenAI fallback) |
| `lib/cache.js` | Redis caching with `buildCacheKey()`, `getCache()`, `setCache()` |

## Dev workflow
```bash
npm run dev      # Starts server.js (required for Socket.IO)
npm run build    # SKIP_ENV_VALIDATION=true next build
npm start        # Production mode
npm run seed     # Seed database (scripts/seed.js)
npm run migrate  # Run migrations (scripts/)
```

## Gotchas
- **No caching on routes**: `next.config.js` enforces no-store headers — don't change without testing
- **Socket guard**: always `if (global.io)` before emitting
- **Docker uses `.env`** (not `.env.local`) — see `docker-compose.yml`
- **Models in `lib/tenantModels.js`**: all schemas are defined here (not in `/models/` for tenant routes)
- **Employee vs User**: `User` is auth record, `Employee` is HR profile — they're linked via `User.employeeId`
