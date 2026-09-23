# API response-path audit — 23 September 2026

This is a source-level audit, not a production latency benchmark. No real HR
records, invitations or attendance punches were created for load testing.

## Changes in this pass

| Flow | Observed response-path cost | Change |
| --- | --- | --- |
| Meeting creation | Recipient lookups repeated per invitee; delivery work starts before responding | One recipient lookup in a Next.js `after` callback; delivery promises awaited there; tenant models passed to push delivery |
| Board creation/list | Redundant user lookup even when authenticated employee ID exists | Reuse authenticated identity, retain legacy fallback |
| Opening a newly created board | Create response followed by a blocking editor GET | Return persisted initial board data and seed the active SWR cache before navigation |
| Project creation | Sequential invitations and email-queue work awaited in request | Post-response invitation and email work |
| Standalone task creation | Assignment notifications delay save response | Post-response delivery; assignment and timeline writes remain required before success |
| Announcement creation | Recipient discovery and push fan-out delay save response | Post-response recipient discovery and delivery |

Meeting and board creation now expose `Server-Timing` response headers. This
measures server time only, not network time or client rendering.

## Screened but not declared resolved

- Shared auth/cache path already has an in-process cache and a bounded remote
  cache budget. Do not weaken authorization or tenant checks to speed it up.
- Asset creation requires assignment validation, persistence and response
  population. No email-provider wait was found in that route.
- Employee creation has required lifecycle, leave-balance and account writes.
  Moving these after success would incorrectly claim a complete employee record.
- Remaining candidates include project-specific task creation/approval/member
  actions, policy publishing, leave/expense actions and large recurring meeting
  series. Their production durations and correctness boundaries need separate
  verification; they have not all been optimized by this change.
- Explicit email-send, password-reset, AI-summary and cron endpoints cannot be
  classified as slow solely because they await an external service. Their
  response contract may require that result.

## Verification and limits

Regression tests cover responding before invitation lookup/delivery, failed save
without queued invitations, tenant-scoped delivery without a socket server, and
board creation without redundant identity queries. Full-viewport editor coverage
also tests the fallback when native browser fullscreen is unavailable.

`after` keeps best-effort delivery within the Vercel request lifecycle; it is not
a durable retry queue. Production p50/p95 measurements, large-tenant load tests,
and actual external delivery acceptance are still required. No polling or timed
page reload loop was added.
