
# Talio (web) — Copilot Instructions

## Big picture
- **App**: Next.js App Router under `app/` with API routes in `app/api/**/route.js`.
- **Custom server is required**: run the web app via `node server.js` (wrapped by `npm run dev` / `npm start`) so Socket.IO is available as `global.io` (`server.js`). Using `next dev` breaks realtime.
- **Multi-tenant MongoDB**: every company has its own DB. Auth tokens must contain `databaseName`; there is **no fallback** (`lib/auth.js`). Tenant models are bound per-DB via `lib/tenantModels.js`.

## How to write API routes (critical pattern)
- For authenticated API routes, **always** call `getAuthAndModels(request, ['ModelA', 'ModelB'])` from `lib/auth.js` and use `auth.models.*` for queries.
- Avoid importing static `/models/*` in authenticated routes; those are not tenant-bound.
- Realtime events: emit via `if (global.io) global.io.to(`user:${userId}`).emit('event', payload)`.

Example (see `app/api/attendance/geolocation-check/route.js`): route loads tenant models, updates `Attendance`, and optionally sends push.

## Auth and routing conventions
- Route protection is primarily in `middleware.js`:
  - Public allowlists: `publicRoutes` + `publicApiRoutes`.
  - `/superadmin` and `/api/superadmin` bypass middleware auth (they handle auth inside the routes).
  - Dashboard has a `_auth=local` bypass to prevent redirect loops.
- Socket authentication uses **User._id** (not `employeeId`) from localStorage (`contexts/SocketContext.js`).

## Key integrations you’ll hit
- Socket.IO path is `/api/socketio` (client uses `window.location.origin`, `contexts/SocketContext.js`).
- Push notifications helpers live in `lib/pushNotification` (used by attendance geofence flow).
- AI: README mentions “Gemini → OpenAI fallback”; look under `lib/` (e.g. `lib/gemini.js`) before adding new AI calls.
- Docker deployment: `docker-compose.yml` expects `.env` (not `.env.local`) and passes secrets like `JWT_SECRET`, Firebase, ImageKit.

## Dev workflows (web + mobile)
- Web (`talio-web/Talio`):
  - Dev: `npm run dev`  (starts `server.js`)
  - Build: `npm run build` (has `SKIP_ENV_VALIDATION=true`)
  - Prod: `npm start`
  - Data scripts live in `scripts/` (see `npm run migrate`, `npm run seed`, etc).
- Mobile (`talioapp`): Expo Router app under `talioapp/app/` (`npm run start`, `npm run android`, `npm run ios`).

## “Gotchas” observed in this repo
- Don’t increase caching on routes lightly: `next.config.js` enforces **no-store** headers to prevent “white screen” issues.
- When emitting sockets from API routes, always guard with `if (global.io)`.


