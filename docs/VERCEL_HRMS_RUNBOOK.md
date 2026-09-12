# Talio Vercel and HRMS workflow runbook

## Runtime conversion map

| Previous VPS assumption | Vercel implementation | Verification |
| --- | --- | --- |
| Custom long-running Node/Socket.IO server | Pusher authenticated tenant/user channels | Send chat, notification, presence, and dashboard refresh events between two accounts |
| Peer-mesh meeting media | LiveKit Cloud SFU with adaptive stream, dynacast, simulcast, data-channel chat/reactions/hand state | Join as employee and guest, mute, share screen, chat, react, raise hand, minimise and restore |
| Local upload folders | Existing tenant GridFS storage; optional private Vercel Blob for direct large uploads. Never fall back to local disk. | Upload, download, authorize cross-tenant denial, delete |
| In-process schedulers | Vercel Cron routes protected by `CRON_SECRET` and distributed Mongo leases | Invoke every cron with a valid and invalid bearer token |
| BullMQ/long-running workers | Vercel Queue callback with idempotent delivery logs and managed retries | Deliver a signed webhook, fail it, confirm retries and eventual log state |
| Filesystem desktop installers | GitHub Releases metadata and streamed release assets | Check latest version endpoint and platform downloads |
| Large per-process Mongo pools | Cached, bounded serverless pools per tenant | Load test concurrent tenant requests and inspect Atlas connections |
| Local ONNX transcription runtime | Server API transcription from short Opus chunks; recorder stops on mute | Speak, mute, verify no muted segment is persisted |
| SheetJS parsing duplicated by module | One bounded ExcelJS adapter and lazy client exporter | Preview/import employee and asset workbooks; export payroll/performance/attendance |

## Required Vercel project resources

1. Link the Git repository and select Next.js with Node 20.
2. Place the project in `bom1` (or change both `vercel.json` and queue configuration to the region nearest MongoDB).
3. Keep MongoDB GridFS for existing uploads. A private Vercel Blob store is optional for direct browser uploads above the function request limit.
4. Create Pusher and LiveKit projects and set every variable documented in `.env.example`. Talio Meet defaults to LiveKit and requires only the server-side `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`; do not enable the legacy Socket.IO transport on Vercel.
5. Configure MongoDB Atlas network access and keep pool overrides conservative.
6. Allow `vercel.json` to provision `talio-webhooks` and `talio-background` queue triggers. Producers await enqueue acknowledgement; workers use tenant-scoped leases and completion records.
7. Use a Vercel plan that supports the configured per-minute cron cadence.
8. Configure the production domain, OAuth callbacks, Firebase origins, GitHub webhook URL, and LiveKit allowed origins.

`GET /api/health?detailed=true` reports missing serverless capabilities without returning secret values.

## September 2026 managed runtime cleanup

Pusher is the selected live-update layer. **No Firebase RTDB migration or dual-write pipeline is planned.** MongoDB remains the HR system of record; Redis remains the shared cache and rate-limit store. Firebase Cloud Messaging is retained for device push notifications and is not RTDB.

- Production Pusher app: `talio-production` (`2193898`, `ap2`). Preview/local app: `talio-preview` (`2193900`, `ap2`). Private credentials live only in environment settings. Both require TLS; raw client events remain disabled.
- Upgrade the Pusher account before exceeding the current 100 simultaneous connections / 200,000 messages per day. Multiple employee tabs consume multiple connections. The two apps share the account's plan limits.
- `/api/realtime/auth` signs only authorized user, tenant, chat and project channels. Shared tenant updates carry invalidation hints, not HR records. Clients refetch through role/tenant-protected APIs without reloading the page. Chat typing/read hints pass through `/api/realtime/events`, which checks membership, derives sender identity and rate-limits requests.
- Development and production now use `next dev` / `next start`. Removed the custom Socket.IO host, Docker/Nginx deployment files, in-process cron modules, local installer manager and legacy employee/guest mesh meeting code. Git history retains all removed files.
- Employee and guest media use LiveKit exclusively. The managed meeting UI, notes, chat, reactions and privacy controls remain in place.
- Notification and productivity work use Vercel Queues. Failed deliveries retry; completed deliveries are deduplicated in each tenant's `backgroundJobResults` collection. This is at-least-once delivery: a process failure after an external push but before acknowledgement may still repeat the external push. Stored in-app notification IDs are deterministic. Device FCM delivery remains best-effort.
- Meeting audio uploads are limited to 4 MB per segment and served through an authenticated meeting-membership check. Existing GridFS uploads fail explicitly if storage is unavailable, rather than returning a temporary local URL.
- Redis maintenance (`POST /api/redis-status`) requires Super Admin authentication; organisation admin/HR may read diagnostics. Rate limiting uses atomic Redis counters with bounded local fallback during outages.
- Desktop/mobile applications and an attendance machine's on-premise LAN bridge are endpoint software, not Vercel-hosted services. They are retained. LiveKit, Pusher, Redis and MongoDB are managed external services consumed by Vercel; Vercel Functions do not host their servers.

Validation: full Jest regressions and production build; two-client private-channel delivery tested against both Pusher apps with synthetic payloads only. These do not substitute for 170-user load testing, device-push acceptance, or authenticated multi-user production workflow testing. Historical `PROJECT_REFERENCE.md` and `PROJECT_MASTER_DOCUMENTATION.md` include retired VPS architecture; use this runbook for current deployment guidance.

## Tenant migration

Always preview first:

```bash
npm run migrate:hrms-workflows
```

Apply only after reviewing the tenant and flag counts:

```bash
DRY_RUN=false npm run migrate:hrms-workflows
```

The migration is idempotent. It fills missing canonical module flags, repairs enabled dependency chains, records the workflow-kernel version, and creates the workflow/audit indexes in each active tenant database.

## HRMS lifecycle and module controls

The canonical lifecycle is manpower planning → MRF → recruitment → interview → offer → pre-joining → background verification → onboarding → employee profile → attendance → leave/WFH → payroll/PF/ESIC → performance/KRA/KPI → learning → exit → F&F → experience letter → alumni.

Super Admin can enable modules per tenant. Enabling a module enables its prerequisites; disabling a prerequisite disables dependants. Every API request is checked against the same registry used by the sidebar and workflow UI. POSH and disciplinary cases are confidential, all transitions use optimistic concurrency, and every transition creates an audit event.

## Release gates

Run these against a clean checkout and production-equivalent environment:

```bash
npm ci
npm audit --omit=dev
npm test -- --runInBand
npm run build
npm run migrate:hrms-workflows
```

Then deploy a Vercel preview and test two tenants independently. Verify authentication, tenant isolation, every enabled module, disabled-module 403 responses, uploads, email, push, realtime chat, meetings, scheduled jobs, queues, desktop update metadata, and the complete hire-to-alumni workflow before promoting the preview to production.

## Rollback

Keep the previous Vercel production deployment available for instant traffic rollback. The schema migration is additive; old deployments ignore the new collections and feature fields. Do not drop workflow collections or indexes during rollback. Disable newly introduced modules from Super Admin if a single workflow needs to be paused without rolling back the full application.
