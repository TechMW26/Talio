# Talio Vercel and HRMS workflow runbook

## Runtime conversion map

| Previous VPS assumption | Vercel implementation | Verification |
| --- | --- | --- |
| Custom long-running Node/Socket.IO server | Pusher authenticated tenant/user channels | Send chat, notification, presence, and dashboard refresh events between two accounts |
| Peer-mesh meeting media | LiveKit Cloud SFU with adaptive stream, dynacast, simulcast, data-channel chat/reactions/hand state | Join as employee and guest, mute, share screen, chat, react, raise hand, minimise and restore |
| Local upload folders/GridFS fallback | Private Vercel Blob paths namespaced by tenant and owner; direct browser uploads for large files | Upload, download, authorize cross-tenant denial, delete |
| In-process schedulers | Vercel Cron routes protected by `CRON_SECRET` and distributed Mongo leases | Invoke every cron with a valid and invalid bearer token |
| BullMQ/long-running workers | Vercel Queue callback with idempotent delivery logs and managed retries | Deliver a signed webhook, fail it, confirm retries and eventual log state |
| Filesystem desktop installers | GitHub Releases metadata and streamed release assets | Check latest version endpoint and platform downloads |
| Large per-process Mongo pools | Cached, bounded serverless pools per tenant | Load test concurrent tenant requests and inspect Atlas connections |
| Local ONNX transcription runtime | Server API transcription from short Opus chunks; recorder stops on mute | Speak, mute, verify no muted segment is persisted |
| SheetJS parsing duplicated by module | One bounded ExcelJS adapter and lazy client exporter | Preview/import employee and asset workbooks; export payroll/performance/attendance |

## Required Vercel project resources

1. Link the Git repository and select Next.js with Node 20.
2. Place the project in `bom1` (or change both `vercel.json` and queue configuration to the region nearest MongoDB).
3. Link a private Vercel Blob store.
4. Create Pusher and LiveKit projects and set every variable documented in `.env.example`.
5. Configure MongoDB Atlas network access and keep pool overrides conservative.
6. Configure Vercel Queues and allow `vercel.json` to provision the `talio-webhooks` trigger.
7. Use a Vercel plan that supports the configured per-minute cron cadence.
8. Configure the production domain, OAuth callbacks, Firebase origins, GitHub webhook URL, and LiveKit allowed origins.

`GET /api/health?detailed=true` reports missing serverless capabilities without returning secret values.

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
