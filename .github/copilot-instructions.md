# Talio - AI Agent Instructions

## Architecture (CRITICAL)
**Custom Server**: Always use `npm run dev` (not `next dev`) — [server.js](../server.js) initializes Socket.IO alongside Next.js. `global.io` is available in API routes.

**Tech Stack**: Next.js 15 (App Router), MongoDB/Mongoose (Multi-Tenant), Socket.IO, TailwindCSS, AI (Gemini → OpenAI fallback)

**Multi-Tenant Database**: Each company has its own database. Never use `connectDB()` in authenticated routes - use `getAuthAndModels()` instead.

## Core Patterns

### API Routes ([app/api/](../app/api/)) - MULTI-TENANT AWARE
```javascript
import { getAuthAndModels } from '@/lib/auth'

export async function POST(request) {
  // Get auth + tenant-aware models in one call
  const auth = await getAuthAndModels(request, ['Employee', 'Attendance', 'User']);
  if (!auth.success) {
    return NextResponse.json({ message: auth.message }, { status: 401 });
  }
  
  const { user, models } = auth;
  // Use tenant models - these are bound to the user's database
  const employee = await models.Employee.findById(user.employeeId);
  
  // Real-time events
  if (global.io) global.io.to(`user:${user.userId}`).emit('event', data);
}
```

### Multi-Tenant Key Files
- **lib/tenantModels.js**: Schema registry with 40+ models, dynamic model binding to tenant connections
- **lib/tenantContext.js**: Tenant lookup functions (`getTenantByEmail`, `getTenantBySlug`, `getTenantByUserId`)
- **lib/auth.js**: `getAuthAndModels(request, modelNames)` - ALWAYS use this in authenticated routes

### Mongoose Models ([models/](../models/))
**Static models in /models/ are DEPRECATED for authenticated routes**. Use `auth.models.ModelName` instead.
Models still use this pattern for schema definition:
```javascript
export default mongoose.models.ModelName || mongoose.model('ModelName', schema)
```

### Socket.IO
- **Server**: `global.io.to('user:${userId}').emit('event', data)` — always check `if (global.io)` first
- **Client**: [contexts/SocketContext.js](../contexts/SocketContext.js) manages connection
- **Auth**: Socket uses `User._id` (NOT `employeeId`) — see [SocketContext.js#L21](../contexts/SocketContext.js)

### AI Integration ([lib/gemini.js](../lib/gemini.js))
```javascript
import { generateContent, generateVisionContent } from '@/lib/gemini'
const text = await generateContent(prompt, systemInstruction)     // Gemini → OpenAI fallback
const analysis = await generateVisionContent(prompt, images)      // Vision tasks
```

## RBAC Roles ([models/User.js](../models/User.js))
`admin` > `department_head` > `hr` > `manager` > `employee`

## Key Commands
| Task | Command |
|------|---------|
| Development | `npm run dev` (NOT `next dev`) |
| Build | `npm run build` |
| Production | `npm start` |
| DB Migration | `npm run migrate` |
| Debug DB | `node check-db-status.js` |
| Backfill Absents | `node scripts/backfill-absent-attendance.js --start-date=YYYY-MM-DD` |

## Common Pitfalls
1. **Using `next dev`** breaks Socket.IO — always use `npm run dev`
2. **Socket auth** uses `User._id`, not `employeeId`
3. **Missing `global.io` check** causes crashes if socket not ready
4. **Env file**: Use `.env` (not `.env.local`)
5. **Public routes**: Add exceptions in [middleware.js](../middleware.js) `publicRoutes`/`publicApiRoutes` arrays

## Automatic Absent Marking
The system automatically marks employees as absent when no attendance record exists for a working day:

- **Daily Cron**: `/api/cron/mark-absent` runs at 12:30 AM IST (7:00 PM UTC)
- **Manual API**: POST `/api/attendance/mark-absent` with `{ date, startDate, endDate, dryRun }`
- **Backfill Script**: `node scripts/backfill-absent-attendance.js --start-date=YYYY-MM-DD`
- **Audit API**: GET `/api/attendance/audit` to view system-generated records

The system validates:
- Working days (Company.workingHours.workingDays)
- Holidays (Holiday model)
- Approved leaves (Leave model with status='approved')
- Employee joining date

## Attendance Correction Flow
**Single Source of Truth: `Attendance` collection**

### CRITICAL RULES:
1. `Attendance` collection is the FINAL authority for status, checkIn, checkOut, workHours
2. `AttendanceCorrection` is for AUDIT ONLY - never used for UI rendering
3. UI ALWAYS reads from `/api/attendance` endpoint
4. Status is ALWAYS calculated from work hours (never from stored requestedStatus/currentStatus)

### Data Flow:
1. Employee submits correction → `AttendanceCorrection` record created (stores current values)
2. Admin/Head approves → **Attendance record updated** with:
   - New checkIn/checkOut times
   - Recalculated workHours
   - Dynamically determined status (present/half-day/absent)
   - `source: 'correction'`, `createdBySystem: false`
3. **Cache invalidated** → `queryCache.clearPattern()` clears stale data
4. **Socket.IO event** → `attendance-updated` emitted to employee's browser
5. AttendanceCorrection updated with `appliedStatus`, `appliedWorkHours` (audit only)

### Status Calculation (on approval):
When checkIn AND checkOut exist, status is ALWAYS calculated from work hours:
- `workHours >= 7.2h` (90% of 8h) → **present**
- `workHours >= 4h` (50% of 8h) → **half-day**
- `workHours < 4h` → **absent**

⚠️ `requestedStatus` from correction is IGNORED when checkIn/checkOut exist

### System Auto-Absent Handling:
When correction is approved for a system-generated absent record:
- `createdBySystem` is set to `false`
- `source` is changed to `'correction'`
- Status is recalculated from actual work hours

### Real-Time Sync:
- **Socket Event**: `attendance-updated` with `{ type, employeeId, date, status, message }`
- **Frontend Listener**: `app/dashboard/attendance/page.js` listens and auto-refreshes
- **Cache Key Pattern**: `attendance.*{employeeId}` for invalidation

### Key APIs:
- **POST** `/api/attendance/corrections` — Submit correction request
- **PATCH** `/api/attendance/corrections` — Approve/reject (updates `Attendance` record)
- **GET** `/api/attendance` — Get attendance data (single source of truth)

### Utility Scripts:
- `node scripts/rectify-all-attendance.js` — **COMPREHENSIVE FIX** for all stale records
- `node scripts/fix-correction-status.js` — Fix stale correction records
- `node scripts/fix-absent-with-checkin.js` — Fix attendance with checkIn/Out but wrong status

## Key Files
- [server.js](../server.js) — Entry point (Socket.IO + Next.js)
- [middleware.js](../middleware.js) — Auth & route protection
- [lib/mongodb.js](../lib/mongodb.js) — DB connection with auto-retry
- [lib/auth.js](../lib/auth.js) — JWT utilities (`verifyToken`, `verifyTokenFromRequest`)
- [contexts/SocketContext.js](../contexts/SocketContext.js) — Client socket management

