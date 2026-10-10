# Firestore → MongoDB migration

The runtime uses a single `talio_records` bank partitioned by dataset, tenant and
logical collection. Each application envelope and its checked overflow fragments
become one Mongo document. Private Vercel Blob objects stay in place; immutable
backup descriptors and tombstones remain intact. No source data is deleted.

## Application adaptation and request cost

The application data plane is MongoDB-only; there is no source-provider fallback.
Some domain helper filenames/exports retain `firestore` in their names to preserve
the established caller contracts, but they use the native Mongo repositories.
The narrow provisioning facade maps cross-scope account transactions to the same
shared records bank, not a second store. Firebase remains for FCM notifications,
and source SDK access is confined to explicitly listed offline recovery tools.

The runtime boundary audit covers web/API, operational scripts, root entrypoints,
desktop and available mobile/socket sources. It rejects data-plane SDK/REST
access and application/lifecycle imports of offline migration tools. Run:

```sh
node scripts/firestore-migration/audit-runtime.cjs --check
```

Native lookup batches use a shared 100-value bound instead of Firestore's old
disjunction/component ceilings. Ordinary concurrent catalog reads coalesce;
fresh authorization reads never join an older in-flight lookup, and revoked
tenant state cannot be overwritten in the cache by a slower earlier response.
Authentication no longer writes an unused Redis profile on each request.
Permissions resolve current custom roles without rewriting a user cache;
legacy role definitions do not trust stale persisted permission caches.

Account quotas use a bounded snapshot-session count, not hydration of thousands
of active-user records. Cross-scope staged parent/claim reads batch by exact
dataset/database/collection, and duplicate-identity fallback queries project
only owner IDs. Partial scoped project/task indexes support Kanban hot paths;
index installation never drops or replaces an existing index. These reduce
round trips, payload transfers and redundant writes, not authorization checks.
Billing savings have not been measured.

Isolated native and loopback HTTP acceptance use a newly owned random dataset,
never the imported production catalog. External delivery credentials are blanked
in the HTTP child; authorized media metadata/304 tests do not fetch or upload
Blob bytes. Temporary records are backed up before exact-namespace cleanup, and
records, unique claims and the catalog must all be absent afterward. Passing
these tests establishes application readiness, not a final live-source cutover.

Leaving the source freeze deferred does not authorize activating stale imported
production catalogs. Final reconciliation, missing-media disposition and queued
job preservation remain required before changing the live deployment.

## Protected export first

Local artifacts live under ignored `.migration-data/<run>/`, mode 0700/0600.
They contain private application data and must never be committed or published.
Configure explicit Firestore credentials in the established `.env.local` file.

```sh
node scripts/mongodb-migration/migrate.cjs inventory mongo-return-20261010
node scripts/mongodb-migration/migrate.cjs export mongo-return-20261010
node scripts/mongodb-migration/migrate.cjs verify-source mongo-return-20261010
node scripts/mongodb-migration/migrate.cjs plan mongo-return-20261010 --datasets=local-firestore-20261003-01,live-firestore-20261004-01
```

Inventory is a fast root-only count and explicitly **not complete**. Export
recursively visits every root/subcollection, including children of nonexistent
parent documents, migration archives, catalogs, media descriptors and fragments.
Completed collections resume only when source values/update times still match.
A changed/deleted/added source document aborts rather than silently mixing states.
Raw protobuf archival preserves 64-bit integer precision, timestamp nanoseconds,
references, geography and bytes; application conversion follows existing codec
semantics. Collection and document SHA256 hashes verify the local archive.

Production archive readers retain only checked identities, byte offsets and
hashes in memory. Document bodies are decoded on demand through bounded file
handles; changed inode/size/timestamps or payload hashes fail closed. Export,
source verification, sizing, import, parity, media planning, reconciliation and
delta application do not retain complete collection payloads. Recovery seeding
closes these readers before creating preservation hardlinks, because a hardlink
changes the source inode's ctime. Do not seed/link a baseline while another
indexed reader is still using it.

`MONGODB_EXPORT_CHILD_CONCURRENCY` bounds child-collection discovery (default 16,
maximum 128). `MONGODB_EXPORT_BATCH_SIZE` bounds reads per batch (default 64,
maximum 256). Batch progress contains only aggregate counts and hashed collection
tokens, not document paths or values. Interrupted partial files are retained
with a `.preserved-<timestamp>` suffix; completed collections are rechecked and
their children rediscovered, never blindly skipped.

Transient deadline/resource/unavailable/internal read failures retry only the
failed RPC, up to five attempts with bounded backoff. Permission and integrity
failures never retry. A retrying child discovery does not reread an already
successful document batch. No pending traversal queue existed in earlier runs;
it cannot be invented from envelope parts or assumed missing children.

If source changes make strict resume impossible, create an explicit new recovery
generation. This local-only initializer validates and hard-links completed
archives, retaining the failed run unchanged. The new export re-reads all source
data/topology and preserves older collection versions before replacing its own
manifest pointers. It logs aggregate changes and remains a per-document baseline,
not a point-in-time snapshot or final write-fenced candidate.

```sh
node scripts/mongodb-migration/recover-baseline.cjs mongo-return-20261010 mongo-recovery-20261010
MONGODB_EXPORT_CHILD_CONCURRENCY=128 MONGODB_EXPORT_BATCH_SIZE=256 MONGODB_EXPORT_REUSE_UNCHANGED=1 node scripts/mongodb-migration/migrate.cjs export mongo-recovery-20261010
```

The optional `MONGODB_EXPORT_REUSE_UNCHANGED=1` applies only to explicit
recovery generations. It reuses a checksum-validated saved body only when a
fresh metadata read has the same existence and exact valid `updateTime`. New,
changed, or unversioned documents are read in full, and every document's child
collections are still discovered. This reduces repeated payload transfer, not
Firestore's per-document read billing. It is not a source write fence or a
point-in-time snapshot. `verify-source` always reads full bodies, regardless of
this setting. Firestore's [document version semantics](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents)
define `updateTime` as server-managed and monotonically increasing per change.

The explicit recovery mode is bound to the retained original run/manifest hash;
ordinary resume and all source verification remain strict. A full final frozen
reconciliation, complete BSON/parts planning and independent parity are still
required. Higher concurrency changes throughput, not which documents are read.

## Allowlisted target and parity

Set `MONGODB_URI` and `MONGODB_DATABASE` privately, then provide the exact target
host/database independently. A conflicting existing record is not overwritten.
The import is bounded, idempotent and insert-only; verification checks each raw
archive, application reconstruction, claim, catalog and collection total.

```sh
node scripts/mongodb-migration/migrate.cjs import mongo-return-20261010 --host=YOUR_CLUSTER.mongodb.net --database=talio --datasets=local-firestore-20261003-01,live-firestore-20261004-01
node scripts/mongodb-migration/migrate.cjs verify-mongo mongo-return-20261010 --host=YOUR_CLUSTER.mongodb.net --database=talio --datasets=local-firestore-20261003-01,live-firestore-20261004-01
```

Sizing refuses imports beyond a conservative 400 MiB free-tier allocation unless
an explicit `MONGODB_MIGRATION_STORAGE_BUDGET_BYTES` is supplied for another target.
This is a storage safety estimate, not a measured Atlas billing result.

Neither export nor two matching scans establishes a global point-in-time snapshot
while production is writable. Freeze writes/reconcile final changes and repeat
source+target verification before cutover. Catalogs remain `mongoVerified:false`
and `applicationCutover:false` until independent acceptance. Verify all Blob
objects separately. Firebase Auth/Storage auxiliary datasets are a separate
inventory: this tool does not claim their absence or migrate Firebase Auth users.

## Final changes while the initial export ran

The first export is a protected baseline, not a write journal. Before importing
the final candidate, freeze **all** application/cron/webhook/worker writers to the
source and keep the target non-writable. Then create a distinct candidate:

```sh
MONGODB_EXPORT_CHILD_CONCURRENCY=32 node scripts/mongodb-migration/reconcile.cjs mongo-return-20261010 mongo-final-20261010 --datasets=local-firestore-20261003-01,live-firestore-20261004-01
node scripts/mongodb-migration/migrate.cjs verify-source mongo-final-20261010
```

Reconciliation traverses the complete current source again, rather than assuming
that only the known tenant collections changed. It retains the baseline and
every removed/previous document there, writes a new complete archive, and produces
`source-delta.json` (added/updated/removed/checksum identities) plus an offline
`target-delta-plan.json`. No Mongo connection/writes, cutover, environment changes
or source deletes occur. Metadata-only source writes do not produce redundant
native Mongo writes. Changed overflow fragments produce an owning-record delta.

If no baseline was imported, import the final candidate rather than the stale
initial baseline. If the baseline was already imported, insert-only import
cannot apply changed/deleted records; use the fenced delta application below.
Reverify all documents, totals and Blob bytes before marking the catalog
verified, then switch writers and release the freeze. A completed candidate is
immutable; use a new run ID for another final scan if the source changes.

Without an existing change journal/PITR, a document created **and deleted**
between reads cannot be reconstructed. The tool explicitly does not claim to
recover every historical/transient mutation. Frozen full reconciliation and a
matching source pass establish the latest retained application state, not an
otherwise unavailable historical event stream.

## Atomic final delta into an already imported baseline

After all source writers are frozen, the completed candidate has passed
`verify-source`, and the initial baseline has passed `verify-mongo`, root must
explicitly install a target fence document in `talio_migration_controls` with
`_id: "write-fence"`, `active: true`, exact `baselineRun`, `candidateRun`, and
selected `datasets`. Both selected catalogs must still have
`applicationCutover: false` and `mongoVerified: false`. App writers must remain
blocked on this target. These tools do not install or release that fence.

```sh
node scripts/mongodb-migration/apply-delta.cjs mongo-return-20261010 mongo-final-20261010 --host=YOUR_CLUSTER.mongodb.net --database=talio --datasets=local-firestore-20261003-01,live-firestore-20261004-01
node scripts/mongodb-migration/migrate.cjs verify-mongo mongo-final-20261010 --host=YOUR_CLUSTER.mongodb.net --database=talio --datasets=local-firestore-20261003-01,live-firestore-20261004-01
```

Delta application independently allowlists the exact URI host/database and binds
the run to both manifest hashes, every operation checksum, and batching limits.
It verifies optimistic before-hashes for every record, fragment bundle, claim,
catalog and final raw-ledger insertion before staging mutations. Bounded Mongo
transactions (default 64 operations and 8 MiB including recovery size) commit
the data changes and resumable checkpoint together, using snapshot reads and
majority writes. `MONGODB_DELTA_BATCH_WRITES` can lower/raise the count up to 100;
retain the same limit when resuming. It touches the fence inside each transaction
so concurrent fence release conflicts instead of allowing snapshot write skew.

Protected per-batch BSON/gzip before-images are atomically published under the
candidate's `mongo-before-images/` directory before mutation. They retain exact
old target bodies, including removed live records, and are never overwritten.
The immutable baseline raw archive remains intact; unchanged final raw entries
reference checked baseline payloads instead of duplicating their bytes. Final
verification resolves and checks those references, every application record,
claim/catalog and total. Changed raw entries retain full new payloads. A resume
checks the committed after-state rather than blindly trusting checkpoints.

The tool deliberately leaves both catalogs unverified/non-writable and returns
`fullVerificationRequired: true`. It does not establish a source freeze, prove
media bytes, activate Mongo, release any fence, or claim automatic rollback.
Before-images and retained source archives provide recovery material; any
rollback requires a separately scoped, checked recovery operation.

## Bounded indexes and measured hot reads

Plan is read-only and does not connect to Atlas. Applying indexes requires the
exact allowlisted target. It installs 33 total indexes including `_id_`, stays
below MongoDB's 64-index limit, never drops indexes and stops on conflicts.
Partial field-existence filters avoid adding every record to every query index.
These indexes cover the repeatedly used authentication, tenant mapping,
employee linking, attendance and screenshot paths, rather than indexing every
optional field. No TTL index deletes migrated records or session history.

```sh
node scripts/mongodb-migration/setup-indexes.cjs plan
node scripts/mongodb-migration/setup-indexes.cjs apply --host=YOUR_CLUSTER.mongodb.net --database=talio
node scripts/mongodb-migration/setup-indexes.cjs explain --host=YOUR_CLUSTER.mongodb.net --database=talio --tenant=talio_company_YOUR_TENANT
```

Set `MONGODB_DATASET` explicitly before measuring. Explain reads actual records
from the chosen tenant and reports keys/documents examined, execution time and
selected indexes for bounded hot queries. Missing domain samples are explicitly
unmeasured, not fabricated successes. The command makes no data writes.

## Read-only media acceptance without copying Blob objects

For actual application HTTP acceptance before production cutover, run the opt-in
loopback harness against the exact allowlisted Atlas host/database:

```sh
MONGODB_ACCEPTANCE_CONFIRM=isolated-temporary-records node scripts/mongodb-migration/http-acceptance.cjs --host YOUR_CLUSTER.mongodb.net --database talio --execute
```

Without `--execute`, the command only plans. Execution owns a cryptographically
random `http-acceptance-*` dataset and synthetic tenant/account records; it never
uses real accounts or edits environment files. A development server binds only
127.0.0.1 on an ephemeral port, with a separate compiler cache and random JWT
secret. Local acceptance suppresses external delivery/cache/realtime; external
credentials are emptied in the child process. The harness verifies real password
login and persisted sessions, member/account linking, saved custom Kanban status
and task filtering, media metadata authorization before 304, and foreign-tenant
and unauthenticated denial. Its synthetic media descriptor has **no uploaded
Blob object**: this test deliberately does not claim byte-serving acceptance.
The server stops before cleanup; all exact test-namespace records/claims/catalog
are backed up with private file permissions before bounded deletion, with zero
remaining records verified. Private server logs and recoverable backup location
are retained. No source database or production dataset is mutated.

The export retains inline binary fragments and media descriptors. Private Blob
objects stay in their current store; do not duplicate their bytes into MongoDB or
create another Blob bank. Inspect references from a complete, selected export:

```sh
node scripts/mongodb-migration/verify-media.cjs plan mongo-final-20261010 --datasets=local-firestore-20261003-01,live-firestore-20261004-01
node scripts/mongodb-migration/verify-media.cjs verify mongo-final-20261010 --datasets=local-firestore-20261003-01,live-firestore-20261004-01 --max-bytes=EXPLICIT_BYTE_BUDGET --concurrency=2
```

Plan performs no network calls. Verify requires the existing private Blob token,
streams each deduplicated required object once, and checks available source SHA256
and length. It performs only Blob `get`, never `list`, upload, deletion or local
media copies. Reads/egress may incur provider charges; choose an explicit total
byte budget (known source lengths are checked before reads) and concurrency 1-4.
A received stream chunk can cross the budget before cancellation; this is not a
zero-overrun provider billing cap. Output contains aggregate counts and hashed
identities only, not filenames, paths, URLs, record values or provider errors.

Missing objects, corrupt bytes, invalid repository ownership, conflicting
descriptors and an incomplete byte-budget stop fail acceptance. Immutable source
backups are required even after deletion, while separately tombstoned current
objects are not. Records containing current and backup descriptors cover both.
Generic unchecksummed references can establish availability, not original-byte
integrity; `fullSourceIntegrityVerified` remains false. External media URLs are
counted as unverified and are not fetched (avoids arbitrary external requests).
The script is Blob acceptance, not a claim that Firebase Auth/Storage inventories
are complete. Repeat on the frozen final candidate, and separately verify target
record/descriptor parity using `verify-mongo`.

Verification retains every failed object's sanitized hash and error category,
bounded by the number of attempted objects. Older reports capped failures at
100: the unrecorded identities cannot be reconstructed from aggregate counts.
Do not treat those omitted failures as available objects or reread all healthy
media merely to prepare an offline recovery plan.

Compare a retained report against the exact unchanged archive without any
network reads, provider credentials, source writes, or media copies:

```sh
node scripts/mongodb-migration/media-recovery-plan.cjs mongo-final-20261010 --datasets=local-firestore-20261003-01,live-firestore-20261004-01 --report=media-verification.json --report-sha256=EXACT_REPORT_SHA256
```

The report must be in that protected run directory. Its SHA256, archive/source
hashes, dataset allowlist, reference hash, and completed verification totals
must match. Output contains only hashes, checksum/length metadata and counts;
private filenames and URLs are not emitted. Identical checksum and length
identify possible immutable or mutable donor descriptors across the selected
baseline, **not** verified available bytes. Known failed objects are excluded
as donors; omitted failure keys and incomplete candidate coverage stay explicit.
Donor groups are computed once, with exact counts and at most 16 representative
hashes per category per failed object, avoiding quadratic output for identical
media. Every recorded failed identity is still retained.
This planner cannot recover unavailable bytes, bypass media acceptance, or
authorize copying another tenant's media into a live record.

## Explicitly authorized unavailable-media removal

`media-inventory.cjs` inventories the complete required object set using bounded,
scoped Blob LIST calls and previously verified store anchors. It does not download
media bytes or modify the store. A truncated verifier failure list is not a valid
inventory. Availability/length metadata is not checksum verification; byte
acceptance must still be repeated against the final frozen candidate.

After the user explicitly chooses `remove-unavailable-media-only`,
`media-disposition.cjs` generates a protected deterministic ledger from the exact
source archive and complete inventory. It removes unavailable repository and
screenshot-gallery records, and only missing media references from retained
business records. Available attachments and same-record available immutable
backups are preserved. It never substitutes another owner's matching image.
Raw source archives, claims and Blob bytes remain unchanged. Exact native and
raw before-images are retained in the ignored 0700/0600 ledger directory; recovery
is possible but requires a separately checked restoration operation.

`apply-media-disposition.cjs` defaults to a zero-write plan. Execution requires
the exact report SHA, inventory filename, independently allowlisted host/database,
`--execute` and `MONGODB_MEDIA_DISPOSITION_CONFIRM=remove-unavailable-media-only`.
Before connecting, it awaits deterministic source/ledger regeneration. Selected
catalogs must remain unverified/non-cutover under an exact target write fence;
`--prepare-fence` can install that fence only on inactive catalogs. Every bounded
snapshot/majority transaction checks the current before-image, fence and catalog,
and commits a resumable checkpoint with the mutation. All after-images are
independently checked. No source, Blob or catalog activation writes occur.

Native parity and available-media acceptance require the same explicit overlay:
`--disposition=/absolute/protected/ledger-directory`, `--disposition-sha256=SHA`,
`--inventory=/absolute/protected/inventory.json`, `--inventory-sha256=SHA` and
`--decision=remove-unavailable-media-only`. Overlay imports are forbidden;
verification checks the original raw archive and cleaned native records separately.
Intentionally removed media prevents a claim of full source-media integrity.

This is an inactive-target cleanup, not production cutover. A later final delta
must account for these modified before-images: do not apply an original-baseline
delta blindly to a pruned target. Preserve original parity evidence before
writing overlay parity reports. Queue payload loss requires separate explicit
authorization; permission to delete unavailable media does not waive queued jobs,
the final source reconciliation, writer fencing or production acceptance.

## Required write fence before final reconciliation (prepared, not activated)

`TALIO_MIGRATION_PRODUCER_PAUSE=1` is an opt-in preparation phase, distinct from
`TALIO_MIGRATION_FREEZE=1`. It returns retryable/no-store 503 responses for
external API traffic, including GET side effects, crons, webhooks and socket
routes. Only exact GET `/api/health` remains public; exact POST queue callbacks
pass only on the server's Vercel environment and retain their existing private
`queue/v2beta` trigger bindings. The polling SDK is not a JWT-authenticated
public callback mechanism. Local public handlers cannot use the exception.

Consumers can still write and enqueue follow-up work during this phase. A full
freeze takes precedence and stops both producers and consumers. Neither env
setting updates old deployments or establishes authoritative queue completion.
Before using provider WAF/cron controls, back up the exact Talio project config,
account for existing bypasses and old hosts, and verify that private consumers
continue unaffected. Do not pause a whole project, revoke source writes, or
delete deployments as a substitute for pending-payload preservation. If safe
completion remains blocked, avoid an open-ended production outage.

An environment toggle on a new deployment alone is insufficient: old deployments,
in-flight calls, local tools and provider consoles can still write. The final
freeze must cover these planes before `reconcile` and remain active until target
acceptance and writer cutover:

- Stop/drain API writes from web, desktop, mobile, the attendance bridge,
  external webhooks and integrations. A fail-closed maintenance middleware should
  return retryable maintenance errors for all APIs except narrow liveness and
  read-only diagnostics; do not assume all GET routes are read-only.
- Guard mutation commit paths in `firestoreStore.server.js`, `mongoStore.server.js`
  and `mongoFirestoreFacade.server.js`, plus catalog transactions in
  `firestoreApplication.server.js`. Both selected-provider and cross-scope/raw
  writers need coverage; business-layer guards alone miss those paths.
- Guard direct metadata writes in both media repositories and private object
  `uploadTenantBlob`/`deleteTenantBlob` in `blobStorage.server.js`. Disable new
  `imageVariants.server.js` creation on GET cache misses (serve authorized original
  bytes instead). Upload token issuance must stop as well as upload completion:
  already issued direct-upload tokens and active uploads require expiry/draining.
  Resume ingestion, Mira image output and employment/exit PDF generation use this
  same Blob plane.
- Pause/drain every `app/api/cron` route and durable queue consumers using
  `firestoreBackgroundJobs.server.js`/`firestoreLease.server.js`; completion/lease
  release also mutate data. Preserve queued/pending jobs for safe replay instead
  of acknowledging unfinished work. Stop irreversible email/notification/webhook
  side effects during the freeze, not merely their later database updates.
  Vercel queue consumers remain attached to their original deployment after
  promotion. A quiet log or a 24-hour wait is not proof of successful draining:
  messages may expire, and existing webhook consumers can acknowledge terminal
  failures before durable logging. Current result/inbox banks are not a producer
  outbox and cannot reconstruct jobs that never started. Obtain verified queue
  completion or provider-backed payload preservation before revoking source
  writes; deleting old deployments is not a lossless drain mechanism. See
  [Vercel queue delivery semantics](https://vercel.com/docs/queues/concepts).
  The installed queue polling SDK is not a read-only backlog peek: a zero
  visibility timeout is clamped to a positive lease and successful handlers
  are automatically acknowledged. Available-message reads do not enumerate
  delayed/in-flight jobs, and Observability's "Queued" count measures sends
  during a period, not current outstanding work. Do not use either as drain
  evidence. No queue receive, lease, acknowledgement, replay or deletion is
  authorized merely by running the read-only migration tools.
- Revoke writes on the Firestore **data-plane** principal after draining to catch
  overlooked sources; do not disable the Firebase messaging account wholesale.
  Scope provider IAM carefully if data and FCM credentials share an identity.
  Account for admin consoles, scripts and all old Vercel deployments. Confirm
  the write fence actually blocks each writer, wait bounded in-flight durations,
  then run a fresh full reconciliation and matching source verification.

The Mongo-only application now has fail-closed middleware and mutation guards
controlled by `TALIO_MIGRATION_FREEZE=1`; these are not activated automatically.
The source deployment must receive its own maintenance fence before cutover,
and its data-principal permissions must protect old deployments as described
above. The endpoint/worker and data-principal freeze must be independently
authorized and tested; matching scans without that protection must not be
described as zero-loss cutover proof.

### Optional proven orphan-only client-upload tail

The strict Blob `blocked:true` / `inFlightDrained:true` path remains valid. For
the independently reviewed source revision
`9e36fe1546add7128589ae5cebf930bab11e787d` only, activation also accepts a narrower
catalog-integrity invariant without pretending that all physical uploads ended.
Already-issued direct-client tokens enforce `allowOverwrite:false`; ordinary
preparation produces a fresh UUID pathname; the upload-completion callback is a
metadata no-op, and the client must subsequently call the source API to persist
its descriptor. The token issuer enforces a tenant prefix, **not UUID syntax**.
No-overwrite enforcement, availability of every retained required object, and
denied descriptor commits are the actual safety boundary.

The Blob plane must honestly retain `blocked:false`, `inFlightDrained:false`,
and explicitly set `orphanOnlyTail:true`. Its `orphanTail` version-1 evidence is
validated by `blob-orphan-tail.cjs` and must include:

- Exact candidate run/manifest/source hashes, Talio source project/default
  database, exact reviewed 40-character revision, all four literal reviewed
  source-file hashes, and the exact exported token-protocol review hash/facts.
- Fresh provider evidence binding that revision and all possible token issuers;
  a successful positive source read plus actual denied metadata mutation probe
  with zero granted project write permissions. Its protected probe-report hash
  must also bind the separately strict `firestore-data-principal` plane.
- Timestamped, proved blocking and completed drain of **all server** Blob
  uploads/deletes/variants, bound to HTTP/cron evidence hashes. These checks must
  fall within the source fence window, with server drain after metadata denial.
- The exact protected media-verification file hash, retained-reference hash,
  verified-object hash and required-object count. Ordinary required-media
  availability/checksum/length and full/partial-source-integrity checks still
  run first and cannot be bypassed by this alternative.
- Explicit `physicalClientUploadsBlocked:false`,
  `physicalClientUploadsDrained:false`, `clientTokensExpired:false`,
  `orphanCleanupDeletionAuthorized:false`, `orphanCleanupPerformed:false`, and
  `descriptorReplayPerformed:false`. This alternative never deletes media or
  replays orphan descriptors. Separately authorized unavailable-media cleanup
  remains governed by its existing exact ledger and parity gates.

Such late client uploads can only leave unreferenced, non-overwriting objects;
they cannot change the final source catalog or the verified retained Blob bytes.
This is **not** proof of token expiry, multipart completion or a lossless orphan
inventory. No one-hour wait is falsely described as a complete drain. The
truthful invariant is retained in the catalog activation audit, and all other
writer planes, fresh source reconciliation, Mongo parity, target maintenance and
deployed acceptance remain mandatory. Unknown/different issuer code or a missing
proof fails closed and must use the ordinary strict Blob fence instead.

`probe-source-freeze.cjs` prepares or, with explicit `--execute`, runs only an
exact source data-SA diagnostic: positive catalog read, project permission
inventory and a Commit with an impossible epoch `updateTime` precondition. It
requires a protected absolute source env path and a fresh private report path,
prints aggregate statuses only, and never labels its single-principal result a
source-wide freeze. `FAILED_PRECONDITION` is not an IAM-denial success.

## Post-cutover Firestore removal checklist

Keep rollback/source archives and retention until acceptance is proven. Once
MongoDB is verified and is the only active application provider, remove the old
provider branches and `firestore.server.js`/`firestoreStore.server.js` transport,
old Firestore media/lease implementations, Firestore-only indexes/rules and
readiness/health fields, plus data-only environment credentials and deploy
configuration. Rename remaining business helpers only when necessary; names such
as `firestoreAttendance` currently identify provider-neutral business logic and
are not evidence of Firebase calls. Search direct `getFirestore`, Firestore
imports and native transaction paths rather than blindly deleting named helpers.
Retain the offline migration/verification tools and immutable source data until
the agreed recovery period ends; do not delete shared Blob source backups.

**Retain Firebase FCM:** `lib/firebaseNotification.js`, client messaging setup,
`public/firebase-messaging-sw.js`, Firebase public config, mobile Google services
and APNs integration, and messaging credentials are separate from the application
database. `firebase-admin`/`firebase` dependencies remain necessary for messaging.
The named data app (`talio-firestore-data`) is separate from `talio-fcm`; never
delete all Firebase keys/apps/projects as a database-cleanup shortcut. Firebase
Auth/Storage auxiliary-account permission gaps must be resolved independently
before declaring every Firebase datum inventoried.

## Catalog activation under retained maintenance

`activate-catalog.cjs` defaults to a local evidence-only plan and never changes
environment settings. It requires an exact host, database, production dataset,
full dataset allowlist and final reconciliation candidate run. Rerun
`verify-source`, `verify-mongo`, and `verify-media` against that candidate using
the current tools: old reports without explicit run, manifest, dataset and source
hash bindings are rejected. Save the media verifier's JSON output as a private
0600 file. Every JSON evidence file must be an absolute, owned regular file with
no group/other permissions; symlinks are rejected.

```sh
node scripts/mongodb-migration/activate-catalog.cjs FINAL_RUN --host=HOST --database=DATABASE --dataset=LIVE_DATASET --datasets=LOCAL_DATASET,LIVE_DATASET --source-fence=/absolute/private/source-fence.json --media-report=/absolute/private/media-verification.json
```

The source-fence evidence is an independently completed operational checklist,
not something this tool creates or assumes. It must contain:

- `version: 1`, `active: true`, exact `candidateRun`, `candidateManifestHash`,
  canonical `sourceHash`, `sourceProject`, `sourceDatabase`, and `datasets`.
- ISO `writersFrozenSince`, `drainedAt` (both before candidate `startedAt`),
  `recordedAt` (after source verification), and future `expiresAt`.
- `planes` with all keys exported as `SOURCE_WRITER_PLANES`: web/desktop/mobile
  API, old deployments, Socket.IO, Electron telemetry, attendance integrations,
  cron/queues, Blob tokens/uploads/variants, external notification side effects,
  scripts/admin consoles, and the Firestore data principal. Each contains
  `blocked: true`, `inFlightDrained: true`, a factual `method`, and ISO `checkedAt`
  between freeze and drain. Do not mark unavailable checks successful.
- `targetMaintenance` with `active: true`, `allWritersBlocked: true`, observed
  `writeProbeStatus: 503`, the exact 40-character `guardRevision`, and ISO
  `verifiedAt`. This includes old deployments and raw writers, not just new UI.
- If the media plan has external URLs, `externalMedia` must have the exact
  `count`, `status: "preserved-unverified-external-references"`, and authorized
  `riskAccepted: true`. These links remain explicitly unverified. If original
  source checksums/lengths are missing, acknowledge
  `blobIntegrityScope: "availability-and-existing-source-metadata-only"`.

Execution additionally requires explicit shell confirmation
`MONGODB_ACTIVATION_CONFIRM=activate-verified-production-catalog-under-maintenance`,
the effective `TALIO_MIGRATION_FREEZE=1`, and `--execute`. It independently reruns
read-only Mongo parity, then uses one snapshot/majority native transaction to
touch the existing exact target fence and set only the selected production
catalog's verification/cutover flags plus hashed verification audit. All tenant,
permission and other catalog fields stay unchanged; the local acceptance catalog
stays non-cutover. The source evidence must remain unexpired at commit.

Maintenance is **not** released by activation. Deploy the matching Mongo-only
build with maintenance still enabled; independently accept authenticated tenant,
media, realtime and worker behavior before a separately authorized fence release.
If local receipt writing fails after commit, inspect `mongoVerificationAudit` in
the selected catalog; do not rerun activation blindly or overwrite source data.
