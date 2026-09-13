# Talio multitenant backend: staged modernization

Updated 13 September 2026. This is an incremental, backward-compatible refactor,
not a completed replacement of every legacy domain service.

## Runtime and data boundaries

```text
Request -> verified JWT / tenant mapping -> feature + role authorization
        -> tenant-bound model registry -> domain service -> tenant MongoDB
                                              |
                                      invalidate scoped Redis keys
                                              |
                                      Pusher private-channel event
                                              |
                                      refetch affected UI data only

Slow work -> Vercel Queue -> authenticated tenant-bound worker -> stored result
Meetings -> LiveKit (media); Firebase FCM -> device push notifications
```

MongoDB remains the system of record. Each organisation retains its own database;
companies and departments inside it retain their existing references. The
superadmin database contains platform identities, tenant mappings and controls,
not shared employee records. Redis is disposable acceleration/rate-limit state.
Pusher is the live-update layer, not a second employee database. There is no
Firebase RTDB migration pipeline. Existing Firebase FCM must not be removed as
part of that decision.

Managed services are external to Vercel: MongoDB, Redis, Pusher and LiveKit.
Vercel hosts Next.js APIs, cron endpoints and durable queue consumers.

## Implemented foundation

| Concern | Implementation |
| --- | --- |
| Connection amplification | One tenant physical pool per warm process with isolated `useDb` handles; one single-flight superadmin connection attempt, including concurrent cold callers. |
| Failover | Driver retains ownership during transient disconnect; only explicit close invalidates the pool. Old close events cannot discard a newer superadmin connection. Failed opens are closed before retry. |
| Overload | Five-second pool checkout wait bound; no unbounded mongoose command buffering. This is a failure bound, not a promise that every query finishes within five seconds. |
| Tenant name boundary | Validate database names before URI interpolation and handle lookup; reject system databases at the tenant entry point. Authentication still determines which tenant is authorized. |
| Model initialization | Resolve transitive dependencies with a visited set, including cycles and aliases. One connection lookup per model set; warm and cold calls return the same dependency set. Models never cross tenant connections. |
| Cache consistency | Employee lists use the Redis/L1/outage-fallback service exclusively, not an additional independent query cache that could resurrect invalidated data. Tenant, role and filters remain in cache keys. |
| Pagination | Add `_id` as a deterministic tie-breaker to employee-list sorting. Existing page/limit/search and response contracts remain intact. |
| Index management | Additive, dry-run-by-default index migration compares key definitions and propagates real permission/network errors. No `syncIndexes`, index drops, record rewrites or uniqueness changes. |

Files: `lib/tenantDb.js`, `lib/superadminDb.js`, `lib/tenantModels.js`,
`lib/platform/databaseName.js`, `lib/platform/modelDependencies.js`,
`app/api/employees/route.js`, `scripts/migrate-performance-indexes.js`.

## Evidence and acceptance boundary

- Mock concurrency tests issue 100 simultaneous connection requests and verify
  one physical pool creation. These are not a production load test.
- Real disconnected Mongoose model objects validate alias/dependency resolution,
  compilation reuse, connection recycling and tenant separation without reading
  employee records.
- On the current 176-record tenant, the default first-50 employee query changed
  from `COLLSCAN + SORT` examining 176 documents to `IXSCAN + FETCH` examining
  50 documents. The active-status first-50 query also examines 50 documents.
  This measures the record query, not the full API, population queries, counts,
  network latency or end-user page load. Millisecond timings on this small data
  set are not a credible scalability benchmark.
- Four additive indexes were applied across the two current tenant databases:
  `{createdAt:-1,_id:-1}` and `{status:1,createdAt:-1,_id:-1}` per tenant.
- Detailed health uses a direct Redis PING, not a cache read that can be bypassed
  by the caller or satisfied by in-process memory. Provider failure is degraded.
- Regression suite: 605 passing tests, 18 skipped at this checkpoint. Skipped
  tests do not establish coverage of live provider behavior.

## Next migrations (not yet implemented)

1. **Canonical domain schemas.** Compare `models/*` against inline tenant schemas
   field-by-field, including indexes, middleware, methods and collection names.
   Extract shared definitions one domain at a time into existing domain folders.
   Preserve the public model registry facade and add parity tests before switching
   each domain. Do not import default-connection models into tenant services.
2. **Request-scoped data access.** Extend the existing `lib/api/route` and
   `lib/services` patterns; migrate direct routes gradually. Require explicit
   tenant, actor and permitted scope. Keep role-specific projections; audit
   directory endpoints separately from payroll/HR views before changing fields.
3. **Cache invalidation contract.** Consolidate remaining overlapping caches,
   measure hit rates, and introduce domain cache versions for cross-instance
   invalidation. Mutation-triggered refetches must bypass stale L1 entries.
   Never cache authorization errors or share actor-restricted responses.
4. **Query and search migration.** Capture p50/p95 timings by route (without
   names, tokens or payloads), query shape, rows scanned, response bytes and
   pool wait. Use cursor pagination for large new lists while retaining legacy
   page-number consumers. Evaluate indexed prefix/search fields with a versioned
   backfill; current unanchored regex searches still scan candidate records.
5. **Workflow reliability.** Use explicit idempotency and state transitions for
   attendance, leave, payroll, assets and employee lifecycle mutations. Add
   transactional outbox delivery where a committed write must eventually emit
   an event. Keep queue retries safe for partial external-provider failures.
6. **Isolation stress testing.** Exercise two tenants with deliberately identical
   resource IDs, role changes, disabled modules, provider outages and concurrent
   writes. Audit tenant-qualified Pusher resource channels before cloning/importing
   tenant databases. Existing ObjectId uniqueness is not an isolation test.
7. **Capacity acceptance.** Run staged load tests against synthetic tenants,
   compare p95 latency/error rate and MongoDB connection counts, then tune pools,
   query limits and Redis budgets. Pusher Sandbox's 100-connection cap is below
   a possible 170-employee simultaneous deployment; upgrading remains an account
   billing action, not a code change.

Each phase requires its own regression evidence and rollback checkpoint. Keep
existing data and APIs readable during rollout; use explicit versioned backfills
only after parity is established. No broad collection replacement is authorized
or necessary for the foundation changes above.

## Operations

`npm run migrate:performance-indexes` audits only. To apply reviewed additive
indexes, use `DRY_RUN=false npm run migrate:performance-indexes`. Re-running is
idempotent. If an equivalent index exists under another name it is reused.
Do not drop older indexes until production usage confirms they are redundant.

Pool sizes are configured in `lib/platform/databaseConfig.js`. They apply per
warm process, not to the whole deployment: instance count multiplies connections.
Keep tenants co-located only within the same trusted cluster credentials; a
future per-tenant cluster requires a separate connection registry key.

References: [Mongoose multitenancy and reconnect behavior](https://mongoosejs.com/docs/connections.html),
[MongoDB pool checkout limits](https://www.mongodb.com/docs/drivers/node/v6.x/connect/connection-options/connection-pools/).
