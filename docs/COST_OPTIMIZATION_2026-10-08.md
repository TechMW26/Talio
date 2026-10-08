# Talio cost pass — 8 October 2026

## Verified configuration

- Firestore data project: `talio-hrms`, `(default)`, Standard edition, Mumbai (`asia-south1`).
- A projected read of the configured dataset succeeded during this audit.
- Vercel functions are configured for Mumbai (`bom1`) with Fluid Compute.
- Redis is configured. This audit did not establish its current hit rate.
- The application's service account received HTTP 403 for Cloud Billing information. No payment methods, billing associations, accounts, data, indexes, or retention policies were changed.

## Changes

- Employee, HR/admin, and manager statistics reuse successful aggregates for at most 15 seconds. Cache identities include the Firestore project/database/dataset, tenant, fresh user claims, current profile/team scope, and date. Authentication and scope resolution still run on every request. Concurrent misses in one process share a computation; failures are not cached.
- Explicit `x-talio-force-fresh` requests bypass the aggregate cache, including manual dashboard refresh and the existing post-mutation freshness flow. Browser HTTP caching stays disabled for private responses. Ordinary browser no-store requests are distinguished from the explicit server-cache bypass.
- Existing daily probation reminders short-circuit before employee queries. First creation still uses the original transactional duplicate checks, including imported records.
- Actionable notifications coalesce simultaneous requests for the same token/revision, suppress paired focus/visibility events, and pause deadline retries while hidden or offline. Visibility/online recovery revalidates; snooze and decision revisions prevent stale responses from restoring resolved notifications.

## Limits

These changes reduce redundant queries, CPU work, and invocations. They do not establish a measured monthly saving or a hard spending cap. Compare normal-traffic Firestore reads and Vercel compute/transfer after release, excluding migration and backup traffic. Realtime uses Pusher, so DTPS's SSE-specific timeout change is not applicable here. Cron deadlines and attendance workflows were retained.

Outstanding balances are not erased by changing billing accounts. Account-specific restrictions require verification with Google Billing Support.
