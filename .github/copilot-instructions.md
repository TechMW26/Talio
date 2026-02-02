# Talio — Copilot Instructions

## Architecture (big picture)
- Next.js App Router with API routes in `app/api/**/route.js` and a **custom Node server** in `server.js` (Socket.IO depends on `global.io`). Use `npm run dev` (wraps `node server.js`), not `next dev`.
- Multi-tenant MongoDB: **central** DB `talio_superadmin` (TenantCompany/UserTenantMapping/SuperAdmin) and **tenant** DBs `talio_company_{slug}` (User/Employee/Attendance/Project/Task/etc).
- JWT must include `databaseName`; there is no fallback.

## Tenant isolation (critical API pattern)
- For authenticated API routes, **always** call `getAuthAndModels()` from `lib/auth.js`. Do not import tenant models from `models/*` directly.
- Tenant schemas live in `lib/tenantModels.js`; prefer `getTenantModels()` over static imports.
- Example reference: `app/api/attendance/geolocation-check/route.js`.

## Real-time events (Socket.IO)
- Socket.IO endpoint: `/api/socketio` (configured in `server.js`).
- Event constants are in `lib/realtimeEvents.js` and mirrored in `contexts/SocketContext.js`.
- Guard emissions: `if (global.io) global.io.to(`user:${userId}`).emit(...)`.
- Socket auth uses `User._id` (not `employeeId`).

## AI + productivity capture flow
- MAYA AI calls route through `lib/gemini.js` (Gemini primary, OpenAI fallback).
- Desktop app uploads screenshots to `/api/maya/screen-capture`, server analyzes, then notifies via Socket.IO.
- Desktop app sources are in `desktop-app/src/` (capture/session rules in `desktop-app/README.md`); uploads go to ImageKit.

## Auth, roles, and middleware
- Route allowlists live in `middleware.js` (`publicRoutes`, `publicApiRoutes`).
- `/superadmin` and `/api/superadmin` bypass middleware; use `lib/superadminAuth.js` inside those routes.
- Role-based UI: wrap with `<RoleBasedAccess requiredRoles={[...]}>` (see `components/RoleBasedAccess.js`).

## Key libs and patterns
- `lib/tenantModels.js` defines **all** tenant schemas; use `getTenantModels()` not static imports.
- `lib/cache.js` is the Redis helper (buildCacheKey/getCache/setCache).
- Geolocation setup and address resolution are documented in `docs/GOOGLE_MAPS_QUICKSTART.md` and `docs/GOOGLE_MAPS_SETUP.md`.

## Desktop app integration (Electron)
- Desktop app lives in `desktop-app/src/` with `screenshotService.js`, `sessionManager.js`, `offlineQueue.js`, and `socketHandler.js`.
- Capture rules are role-based (Admin never auto-captured; Dept Head limited to own dept); see `desktop-app/README.md`.
- Screenshots are stored under `public/activity/{userId}/{YYYY-MM-DD}/{timestamp}.webp` (see `public/activity/README.md`).

## Dev workflows & tooling
- `npm run dev` → starts `server.js` (required for Socket.IO).
- `npm run build` → uses `SKIP_ENV_VALIDATION=true`; `npm run start` runs `node server.js`.
- Docker uses `.env` (not `.env.local`), see `docker-compose.yml`.
- `npm run seed` and `npm run migrate` run scripts in `scripts/`.
- API audit helper: `scripts/api_error_audit/audit.py` scans `app/api/**/route.js|ts` for status codes and common issues.

## Gotchas
- `next.config.js` enforces no-store headers; avoid adding caching without testing.
- User vs Employee: `User` is auth; `Employee` is HR profile linked by `User.employeeId`.
- Maps: geolocation check-in uses backend-only keys; setup in `docs/GOOGLE_MAPS_QUICKSTART.md` and `docs/GOOGLE_MAPS_SETUP.md`.
