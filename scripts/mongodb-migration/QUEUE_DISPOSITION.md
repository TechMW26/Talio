# Explicit outstanding source-queue disposition

`queue-disposition.cjs` is an offline, pure acknowledgement validator. It neither
stops/receives/acknowledges/replays queues nor deletes source/target business data.
It does not create authorization: an operator must bind a direct human decision
to discard outstanding source background/webhook jobs, with the actual human
message hash and timestamp. A missing/unknown job count stays `null`; discarded
work must never be described as preserved or successfully processed.

## Binding and unchanged gates

Pass `validateQueueDisposition({ evidence, evidenceHash, expected, fence })` only
after reading the protected evidence file and computing its exact byte hash.
The `expected` object contains `run`, `candidateManifestHash`, `sourceHash`,
`sourceFenceEvidenceHash`, `sourceProject`, `sourceDatabase`, `datasets`, `target`,
and `candidateStartedAt`, all from the independently verified final candidate.
The same source-fence evidence must remain active, bound, and unexpired.

The evidence contains those binding fields, plus:

- `version: 1`, `decision` and `userAuthorization` both exactly
  `discard-outstanding-source-queue-jobs`, `authorizationMessageHash`,
  `authorizedAt`, `recordedAt`.
- Exact Talio Vercel project/team, production environment and topics
  `['talio-background', 'talio-webhooks']`.
- `unknownOutstandingCountAccepted: true`, `outstandingJobCount: null`,
  `preservationVerified: false`, `businessDataDeletionAuthorized: false`,
  `queueReplayAuthorized: false`.
- `targetQueueIsolation`: independently verified fresh `deploymentId`, distinct
  `oldProductionDeploymentId`, `freshDeploymentVerified: true`,
  `defaultDeploymentPinning: true`, `deploymentlessRuntimePollingEnabled: false`,
  `archivedJobsReplayed: false`, exact deployed `runtimeRevision`,
  `providerDeploymentEvidenceHash`, `runtimeQueueAuditHash`, and `verifiedAt`.

Queue/old-deployment/external-side-effect/data-principal fence planes still must
be blocked **and in-flight drained**, with checks during the freeze/drain window.
An approved discard is not permission to fabricate drain evidence. Existing
activation validation must still run unchanged for **all** source writer planes,
current Mongo/raw-source parity, media disposition/verification, catalogs and
target maintenance. Include the returned acknowledgement in the activation audit
only; never use it to transform/delete imported business records or release
maintenance. The activation CLI optionally accepts
`--queue-disposition=/absolute/protected/report.json`, reads it through the same
owned-private-regular-file guard, hashes the actual bytes and validates it only
after all existing gates. The acknowledgement is included in the activation audit.
Omitting this flag preserves the existing activation flow; an invalid supplied
report fails closed. An evidence-only plan may use a independently verified fresh
deployment kept under target maintenance; it does not release maintenance or
replace the required deployed acceptance.

## Old consumers and the new runtime

Default QueueClient/send deployment pinning and `queue/v2beta` subscriptions
keep new Mongo deployment jobs separate from old source deployment jobs. Current
runtime constructors do not opt into `deploymentId: null`; the offline archival
tool is not a runtime consumer. Do not run a deploymentless poll/replay worker at
cutover. Verify deployed revision/configuration, not merely local source.

Promotion/rollback does **not** stop old consumer callbacks. They remain on their
original deployment. Vercel explicitly documents deleting an old deployment as
the way to stop its consumer invocations; pending messages then remain until TTL.
Deletion is a separate, exact-target destructive action and is not performed by
this tooling. [Queue deployment semantics](https://vercel.com/docs/queues/concepts).

Project pause applies to the active production deployment/custom-domain
assignment. Do not infer that it halts old deployment consumers, preview URLs,
or private internal queue delivery.
[Pause API](https://vercel.com/docs/rest-api/projects/pause-a-project).

Disable project cron scheduling independently; running cron functions continue
through deployment changes and require a bounded drain.
[Cron maintenance](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

WAF guards incoming CDN HTTP requests; private queue callbacks are internal and
air-gapped, so HTTP probes/WAF alone are not queue-stop proof.
[Firewall concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts),
[Queue consumer security](https://vercel.com/docs/queues).

If old deployments are retained, verify source Firestore data-plane write denial
for **every** effective principal and drain in-flight external side effects before
the final export. Background lease acquisition and webhook pending-log commits
precede their effects, so denying new source commits prevents new processing;
an operation already past that commit may still finish. Preserve Firebase FCM
credentials rather than disabling a shared account wholesale. After cutover,
keep the old data-plane denial/old-URL maintenance in place while re-enabling
only the fresh Mongo deployment and its new pinned jobs.
