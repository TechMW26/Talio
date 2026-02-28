# Talio — AI Coding Instructions

## Repo layout (two apps)
- Web/Server: `talio-web/Talio` (Next.js 15 + React 19, custom Node server).
- Mobile: `talioapp` (Expo + expo-router, file-based routes in `talioapp/app/**`).
- Desktop: `talio-web/Talio/desktop-app` (Electron screen capture client).

## Web architecture (big picture)
- Next.js App Router with API routes in `app/api/**/route.js` plus a **custom Node server** in `server.js` to host Socket.IO (`global.io`). Use `npm run dev`, not `next dev`.
- Multi-tenant MongoDB: **central** DB `talio_superadmin` and **tenant** DBs `talio_company_{slug}`. JWT must include `databaseName`.

## Tenant isolation (critical API pattern)
- For authenticated API routes, **always** call `getAuthAndModels()` from `lib/auth.js`. Do not import tenant models from `models/*` directly.
- Tenant schemas live in `lib/tenantModels.js`; prefer `getTenantModels()` over static imports.
- Example: `app/api/attendance/geolocation-check/route.js`.

## Real-time events (Socket.IO)
- Socket.IO endpoint: `/api/socketio` (configured in `server.js`).
- Event constants in `lib/realtimeEvents.js`, mirrored in `contexts/SocketContext.js`.
- Guard emissions: `if (global.io) global.io.to(\`user:${userId}\`).emit(...)`.
- Desktop app registration sets `socket.isDesktopApp = true` (see `server.js`).

## AI + productivity capture flow
- MAYA AI calls route through `lib/gemini.js` (Gemini primary, OpenAI fallback).
- Desktop app uploads screenshots to `/api/maya/screen-capture`, server analyzes, then notifies via Socket.IO.
- Desktop app sources are in `desktop-app/src/` (rules in `desktop-app/README.md`); uploads go to ImageKit.

## Auth, roles, and middleware
- Allowlists live in `middleware.js` (`publicRoutes`, `publicApiRoutes`).
- `/superadmin` and `/api/superadmin` bypass middleware; use `lib/superadminAuth.js` inside those routes.
- Role-based UI: wrap with `<RoleBasedAccess requiredRoles={[...]}>` (see `components/RoleBasedAccess.js`).

## Dev workflows & scripts
- Web: `npm run dev` (custom server + Socket.IO), `npm run dev:next` (plain Next.js), `npm run build`, `npm run start`.
- Data utilities: `npm run seed`, `npm run migrate`, and other helpers under `scripts/`.
- API audit: `python3 scripts/api_error_audit/audit.py` scans `app/api/**/route.js|ts`.
- Mobile: in `talioapp`, `npm run start` (Expo), or `npm run android` / `npm run ios`.

## Config + gotchas
- `next.config.js` enforces no-store headers; avoid adding caching without testing.
- Docker uses `.env` (not `.env.local`), see `docker-compose.yml`.
- User vs Employee: `User` is auth; `Employee` is HR profile linked by `User.employeeId`.
- Maps: geolocation check-in uses backend-only keys; setup in `docs/GOOGLE_MAPS_QUICKSTART.md` and `docs/GOOGLE_MAPS_SETUP.md`.
