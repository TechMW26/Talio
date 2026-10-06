# Firestore and private Blob migration runbook

## Current boundary — production cutover preparation

On October 4 the owner authorized live deployment and replacement of Vercel's
MongoDB configuration. The earlier local-only restriction below is historical,
not the current authorization. The existing `local-firestore-20261003-01` copy
remains test-only and must not be promoted. A separate `live-*` production
candidate requires a fresh source copy, strict native/media verification, and
reconciliation of the captured source change journal before its catalog can be
marked `ready` / `production` / `applicationCutover: true`. Do not treat a
successful source snapshot verification as proof of zero migration lag.

Vercel Production, Preview and Development now have the Firestore server
credentials and private Blob configuration; MongoDB environment variables were
removed. Production `FIRESTORE_DATASET` remains unassigned until this cutover
gate passes. Existing deployments retain their original environment snapshots.

## Historical local acceptance setup

The application runtime is converted to native Firestore and private Vercel
Blob. MongoDB/Mongoose connections, models, compatibility helpers and package
dependencies have been removed. There is no MongoDB fallback. `bson` remains a
**development-only archive decoder/validator**, not an application database
dependency.

Local `.env.local` currently selects:

- Project: `talio-hrms`; database: `(default)`.
- Dataset: `local-firestore-20261003-01`.
- `TALIO_LOCAL_ACCEPTANCE=1` and `BLOB_ACCESS=private`.
- Server Firestore and existing private Blob credentials, never client-exposed.

Acceptance mode suppresses outgoing deliveries. Use emulator fixtures for
mutating workflow tests; do not send staff notifications or exercise paid/live
integrations as part of validation. The local dataset is a cloud-hosted copy,
not the production application database. Its catalog retains
`purpose: local-acceptance-only` and `applicationCutover: false`; runtime rejects
this dataset when `NODE_ENV=production`.
Redis and realtime provider access are also suppressed; acceptance caches stay
in process and are namespaced by dataset.

The original acceptance phase did not authorize production cutover. Its source
databases and recovery archives must still be preserved. Existing production
data continues changing after the snapshot.
ImageKit media is excluded: its existing references remain unchanged.

## Native architecture

`lib/platform/firestore.server.js` initializes the explicit server data
credential independently of the notification Firebase app.
`firestoreApplication.server.js` requires a verified dataset and registered
tenant. Authentication reloads the current account/role and checks session and
credential revocation before returning tenant context.

`firestoreStore.server.js` implements native indexed filters, bounded cursor
pagination, count queries and transactions. Domain services declare query fields
and uniqueness claims explicitly. There is no legacy query interpreter, model
emulation, silent full-collection fallback or cross-tenant default database.
Transaction callbacks must not perform external side effects.

Application layout:

```text
talioDatasets/<dataset>/databases/<original-database>/collections/<collection>
  /records/<legacy-id-or-stable-hash>
    /parts/<field-hash>-<part-number>
```

`firestoreCodec.cjs` preserves dates, IDs, nested arrays, bytes and oversized
fields using checksummed Firestore parts where needed. Original typed BSON stays
in immutable recovery archives; runtime needs no BSON decoder.
`searchProjection.cjs` defines deterministic search, membership and optional-sort
projections. Writes maintain them; isolated backfills update older records.
Search indexes retain at most 1,000 exact grams; larger texts use an indexed
overflow candidate marker. Native queries include that marker and consumers
apply exact substring matching before pagination/counting. This keeps the index
inline without truncating text or silently dropping long-text matches.

Media, leases, background jobs and domain routes are wired to native services.
`firestoreMedia.server.js` verifies private Blob descriptors, byte lengths and
checksums. Dedicated endpoints enforce ownership and recipient/role access;
generic file delivery cannot bypass repository-owned media ACLs. Imported media
deletion tombstones the application entry without deleting the backup Blob.
Shared historical images resolve only through an owner in the authenticated
tenant; unresolved ownership fails closed. New binary media is stored in Blob.

## Preserved snapshot and recovery evidence

Immutable source run: `talio-20261003-cloud-02`. Snapshot began
`2026-10-03T11:25:55.355Z`; independent staging verification completed
`2026-10-03T12:15:00.926Z`. These are historical point-in-time results, not
continuous replication or proof of final cutover readiness.

- 5 databases, 188 collections, 72,472 BSON records including 8,754 source media
  chunks; 1,242,193,420 original BSON bytes.
- 63,718 non-chunk records preserved in Firestore staging.
- 6,553 reconstructed private Blob files; 1,104,200,092 original media bytes.
- 7 pre-existing orphan chunk groups recovered separately: 3,143,850 bytes.
  Missing filenames/ownership were not invented; raw chunks remain archived.
- Staging reconciliation reported zero missing media and zero unresolved media
  issues after recovery.
- Initial native materialization preserved all 63,718 records and 6,553 media
  descriptors. 70 records used 83 parts, including the 60 previously archive-only
  records. Later projections may change part counts.
- The last saved native acceptance report, completed
  `2026-10-03T17:11:38.702Z`, verified 63,718 source records, 3 extracted Mira
  images (4,106,265 bytes) and 49 tenant-routed AI histories. Original shared
  histories remain preserved. This strict report is retained unchanged.
- Final read-only difference audit at `2026-10-03T21:18:52.667Z` compared all
  63,718 source records after projection updates: 63,716 matched exactly; the
  other two contain only local login/cache timestamp and login-counter changes
  (one user and one tenant mapping). No source records are missing. All 49
  routed histories and 3 extracted images still verify. Four collections contain
  additional local activity: notifications +3, sessions +3, presence +1 and
  security events +3. Preserve these writes. The audit intentionally reports
  `passed: false` rather than claiming the mutable copy is snapshot-identical.
  Its separate report is
  `local-firestore-20261003-01-native-differences-20261003211852667.json`.

Immutable staging is under
`migrationRuns/talio-20261003-cloud-02`. Permission-restricted local BSON
archives, manifests, checkpoints and reports are in
`.migration-data/talio-20261003-cloud-02/`; private Blob also holds recovery
archives and the staging verification report.

Retired source tools/models/configuration are recoverable under ignored
`.migration-data/retired-source/`, including backed-up local environment files.
They are not runtime dependencies. Never commit or share these sensitive files.
The old `run.cjs snapshot/copy/media/recover/verify` workflow is retired; it is
not an executable command in the current application tree. Any future source
delta import needs a separately approved, isolated recovery-tool environment.

## Validation commands

Run from the repository root. Use Node 20–22. Do not run cloud mutation,
backfill or reconciliation commands concurrently for the same dataset.

Static runtime gate (currently reports zero legacy runtime references and
database-driver dependencies):

```sh
node scripts/firestore-migration/audit-runtime.cjs --summary --check
```

Run tests serially. Emulator suites are opt-in and require the dedicated
loopback emulator; ordinary Jest runs skip them.

```sh
# Java 21+ and an installed Firestore emulator jar:
java -jar /path/to/cloud-firestore-emulator.jar --host 127.0.0.1 --port 8185 --webchannel_port 8186 --websocket_port 8187 --project_id demo-talio-firestore
```

In another terminal:

```sh
TALIO_FIRESTORE_EMULATOR_TEST=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 TALIO_LOCAL_ACCEPTANCE=0 npm test -- --runInBand
```

Read-only cloud checks, after all projection writes finish:

```sh
node scripts/firestore-migration/verify-native.cjs talio-20261003-cloud-02 local-firestore-20261003-01
# For a mutable local-test copy: finish all comparisons, report sanitized
# differences separately, preserve the strict report, and exit nonzero on drift.
node scripts/firestore-migration/verify-native.cjs talio-20261003-cloud-02 local-firestore-20261003-01 --report-differences
TALIO_FIRESTORE_NATIVE_READ_DATASET=local-firestore-20261003-01 npx jest tests/api/firestore-native-live-read.test.js --runInBand
```

`verify-native.cjs` independently compares the current dataset against immutable
BSON, allowing only named projections, verified image extraction and uniquely
owner-routed histories. It checks unexpected collection counts and writes the
local report `local-firestore-20261003-01-native-acceptance.json`; it does not
mutate cloud records. It must precede exploratory writes to this snapshot copy.

For explicitly coordinated projection maintenance only:

```sh
# Read-only projection diff:
node scripts/firestore-migration/backfill-native-projections.cjs --dataset=local-firestore-20261003-01
# Write only the isolated acceptance dataset, then rerun verify-native:
node scripts/firestore-migration/backfill-native-projections.cjs --dataset=local-firestore-20261003-01 --write
```

Do not rerun `materialize.cjs copy/verify` against the evolved dataset:
those commands compare the original unprojected baseline. They remain archive
materialization tools for an explicitly selected fresh dataset, not the current
post-transformation acceptance audit.

Local configuration is already installed. If a deliberate restoration is needed,
`configure-local.cjs --write --dataset=local-firestore-20261003-01` validates the
catalog, backs up old local configuration and installs native-only local settings.
It does not modify hosting configuration. Never print its credential inputs.
Use `npm run dev` for local UI testing; production-mode startup intentionally
rejects the acceptance dataset.

## Additive-only composite index deployment

`deploy-indexes.cjs` uses the approved service-account JSON from the repository
`.env` (`FIRESTORE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_KEY`), never
the Firebase CLI login or ambient credentials. Its destination is fixed to
`talio-hrms`, database `(default)`, collection group `records`. The approved
principal is `firebase-adminsdk-fbsvc@talio-hrms-d6239.iam.gserviceaccount.com`;
its owning project differs intentionally from the destination. Permission must
be granted on the destination, not inferred from the owning project.

```sh
# Read-only default: validate the manifest, test IAM, list every index page,
# then report missing/READY/CREATING/NEEDS_REPAIR counts. No index writes.
node scripts/firestore-migration/deploy-indexes.cjs

# Only after explicit index-deployment authorization and an approved temporary
# datastore.indexes.create grant on talio-hrms:
node scripts/firestore-migration/deploy-indexes.cjs --apply --concurrency=2

# Read-only readiness check; exit 2 until every manifest index is READY.
node scripts/firestore-migration/deploy-indexes.cjs --check
```

The tool requires `datastore.indexes.list` and checks current
`datastore.indexes.create` before the first create. It only adds missing exact
index shapes from `firestore.indexes.json`; it never deletes, replaces or updates
existing indexes, field overrides, documents, IAM or deployment configuration.
An existing failed index is reported as `needsRepair`, not deleted/recreated.
Unrelated existing indexes remain untouched. Existing `CREATING` indexes are not
submitted again. Default concurrency is 2, maximum 4. HTTP 429/503 responses use
five bounded attempts with exponential backoff; other errors stop new work.
Accepted requests are not proof of readiness: builds are asynchronous. Rerun the
read-only check until `complete: true`, then perform real cloud-query acceptance.
Do not treat emulator tests as evidence that cloud indexes are ready.

If a run is interrupted or partially fails, retain accepted indexes and rerun
the default dry-run to reconcile live state before applying again. A conflicting
create is reconciled by the final exact-shape listing. Only counts, shape hashes
and numeric HTTP status are logged; raw provider errors or credentials are not.
No Firebase configuration file or CLI account switch is needed. Remove a
temporary index-admin grant separately after approved deployment/readiness.
Building indexes can consume quota and incur storage/write costs; this command
does not authorize production release or data cutover.

API reference: [create composite index](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.indexes/create)
and [paginated index listing](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.indexes/list).

## Pending gates

- Latest optional-sort/search projection backfill and full difference audit
  completed. The isolated copy contains local login activity as recorded above;
  do not reset it merely to make a snapshot comparison pass.
- All 825 definitions in `firestore.indexes.json` are READY in `talio-hrms`
  on 2026-10-04: zero missing, creating or repair-needed indexes. The original
  824 were created after explicit authorization; browser acceptance identified
  one additional status/employee inequality index for sidebar counts. The
  temporary Cloud Datastore Index Admin grant was removed in the owner console;
  read-only IAM verification confirms `canCreate: false`. The original Cloud
  Datastore User role remains.
- `audit-query-indexes.cjs <sanitized-query-corpus.jsonl>` compares observed
  native query shapes with the local manifest; it does not deploy indexes or
  guarantee coverage of unobserved queries.
- Full suite on 2026-10-04: 348 suites / 2,686 tests passed, 3 suites / 23 tests
  skipped, no failures. Seven opt-in native cloud read tests also passed,
  including tenant separation, sorted cursor queries, sidebar counts and Blob.
  The production build compiled all 268 static pages. Its configured type/lint
  checks are skipped; a separate `next lint --dir lib --dir app/api` completed
  without errors (15 existing warnings). `git diff --check` passes.
- Local login, Firestore health, attendance summary, the 125-employee directory
  and personal document listing passed on port 3003. Full role/business-flow
  manual acceptance is not complete; these are focused read-only smoke checks.
- Client realtime initialization now checks the lightweight server capability
  before connecting, so isolated acceptance uses polling without Pusher auth
  503 retries. Failed JavaScript chunks can be recovered through the existing
  user-triggered Try Again button; no automatic reload discards open forms.
- Performance work preserves fresh authorization: independent profile reads
  overlap and reference batches have bounded concurrency. No shared private
  data cache or production-region change was introduced. Development cold
  compilation is not a Firestore latency benchmark.
  Personal documents request only the current employee even for administrators;
  public documents/profile reads overlap and share deduplicated owner lookups.
  Employee-to-account roster lookups also use three concurrent 30-ID batches
  alongside relationship hydration, without increasing query component limits.
  Final focused validation passed 38 tests across 8 suites (including isolated
  emulator document workflows); the final production compilation built all
  268 static pages successfully. No build was deployed.
  Browser personal/public document requests and onboarding returned
  HTTP 200. Cold development compiles still exceeded the 15-second client
  timeout on some directory requests; retry after compilation is not a measured
  production performance guarantee.
- Production requires explicit authorization, a consistent final source-delta
  reconciliation/write-cutover plan, independently verified data, and successful
  acceptance. Preserve source and backups until separately authorized.
