# Productivity screenshot policy

Admins can use Settings → Productivity to enable or disable screenshot uploads
for their tenant. The default is enabled for compatibility. Admin and HR screens
remain excluded regardless of the switch. Attendance is independent of this policy.

The policy is one deterministic `servicesettings/productivity` application record
inside the existing tenant database namespace. Reads are point lookups; updates
recheck the administrator's active role inside the same transaction as the write.
No new environment variables or changes to tenant identifiers are required.

The upload endpoint checks policy before parsing multipart media and returns an
acknowledged `dropped` response when disabled so older clients do not retry forever.
Existing media is not deleted and already queued analysis may complete. Updated
desktop source checks policy before screen capture and fails closed on network
errors; installing that client-side guard requires a desktop rebuild/release.
The server gate works immediately with existing desktop versions.

## Read and index costs

Tenant-local image metadata now reuses the initial lookup, eliminating one
Firestore metadata read per `getImageInfo` call without cross-request caches or
weakening historical shared-image ownership checks.

`firestore.indexes.json` exempts only `records.overflow`, `records.version`, and
`parts.bytes` from automatic indexing. These envelope fields are read by document
ID, never business query filters. All `data.*` indexes remain unchanged. This
reduces unused index storage and write fanout, not the base document-write price.

Deploy exemptions with `node scripts/firestore-migration/deploy-field-exemptions.cjs
--apply` using the approved principal with `datastore.indexes.get` and
`datastore.indexes.update`. Without `--apply`, the script only inspects. It fails
before mutation when permissions are missing. Vercel deploys do not apply these
Firestore administrative changes. No live data is rewritten or deleted.
