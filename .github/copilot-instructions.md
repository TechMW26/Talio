# Talio — Copilot Instructions

## Architecture (big picture)
- Next.js App Router with API routes in `app/api/**/route.js` and a **custom Node server** in `server.js` (Socket.IO needs `global.io`). Use `npm run dev` (wraps `node server.js`), not `next dev`.
- Multi-tenant MongoDB: **central** DB `talio_superadmin` (TenantCompany/UserTenantMapping/SuperAdmin) and **tenant** DBs `talio_company_{slug}` (User/Employee/Attendance/Project/Task/etc).
- JWT must include `databaseName`; there is no fallback.

## Critical API pattern (tenant isolation)
- For authenticated API routes, **always** use `getAuthAndModels()` from `lib/auth.js`. Do not import tenant models from `models/*`.
- Example usage reference: `app/api/attendance/geolocation-check/route.js`.

## Real-time events (Socket.IO)
- Socket.IO endpoint: `/api/socketio` (configured in `server.js`).
- Event constants live in `lib/realtimeEvents.js` and are mirrored for clients in `contexts/SocketContext.js`.
- Always guard emissions: `if (global.io) global.io.to(`user:${userId}`).emit(...)`.
- Socket auth uses `User._id` (not `employeeId`).

## AI + productivity capture flow
- MAYA AI calls route through `lib/gemini.js` (Gemini primary, OpenAI fallback).
- Desktop capture flow: desktop app uploads to `/api/maya/screen-capture`, server analyzes, then notifies via Socket.IO.
- Desktop sources: `desktop-app/src/` (see `desktop-app/README.md` for capture/session rules).

## Auth, roles, and middleware
- Route allowlists live in `middleware.js` (`publicRoutes`, `publicApiRoutes`).
- `/superadmin` and `/api/superadmin` bypass middleware; use `lib/superadminAuth.js` inside those routes.
- Role-based UI: wrap with `<RoleBasedAccess requiredRoles={[...]}>` (see `components/RoleBasedAccess.js`).

## Key libs and patterns
- `lib/tenantModels.js` defines **all** tenant schemas; use `getTenantModels()` not static imports.
- `lib/cache.js` is the Redis helper (buildCacheKey/getCache/setCache).
- Location/geo features are documented in `docs/GOOGLE_MAPS_QUICKSTART.md` and `docs/GOOGLE_MAPS_SETUP.md`.

## Dev workflows
- `npm run dev` → starts `server.js` (required for Socket.IO).
- `npm run build` → uses `SKIP_ENV_VALIDATION=true`.
- `npm run seed` and `npm run migrate` run scripts in `scripts/`.
- API audit helper: `scripts/api_error_audit/audit.py` scans `app/api/**/route.js|ts` for status codes and common issues.

## Gotchas
- `next.config.js` enforces no-store headers; avoid adding caching without testing.
- Docker uses `.env` (not `.env.local`), see `docker-compose.yml`.
- User vs Employee: `User` is auth; `Employee` is HR profile linked by `User.employeeId`.
