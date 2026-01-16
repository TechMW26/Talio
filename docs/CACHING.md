# HRMS Caching Layer (Talio)

This project uses a **tenant-aware cache layer** to reduce repeated API calls while keeping data correct and secure.

## ✅ Key Goals
- Reduce DB load for read-heavy endpoints.
- Keep cache isolated per tenant/company.
- Never cache mutations or real-time data.
- Add lightweight frontend caching for dashboard widgets.
- Reduce repeated JWT verification in middleware.

## 🔐 Cache Key Pattern
All keys include tenant context (database name):

```
tenant:{tenantId}:role:{role}:user:{userId}:{namespace}:{params}
```

Examples:
- `tenant:acme_hr:role:admin:user:all:dashboard:hr-stats:...`
- `tenant:acme_hr:role:employee:user:66f...:profile:...`

## ⏱️ TTL Guidelines (Current)
| Data Type | TTL |
|---|---|
| Profile | 10 min |
| Company settings | 30 min |
| Dashboard stats | 2 min |
| Attendance summary | 2 min |
| Leave balances | 5 min |
| Department head checks | 10 min |
| Notifications config | 30 min |

## ♻️ Invalidation (Current)
Caches are cleared on:
- Employee update/delete (profile + dashboards)
- Attendance clock-in/out (attendance + dashboards)
- Leave approval/rejection (leave balance + dashboards)
- Leave balance updates (leave balance)
- Role/status updates (auth cache)

## 🌐 Frontend caching (SWR)
SWR is enabled for dashboard widgets to dedupe requests and reuse cached data.

Currently cached widgets:
- Attendance summary
- Leave balance
- Employee directory

Defaults:
- Deduping interval: 60s
- Focus revalidation: disabled

## 🧠 Middleware cache
Middleware keeps a short-lived in-memory cache of verified JWT payloads (5 minutes) to reduce repeated crypto work on API/dashboard navigation.

## ✅ Redis Configuration
Set **one** of the following:

- `REDIS_URL=redis://user:pass@host:6379`

OR

- `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`

If Redis is not configured, the cache safely falls back to in-memory storage.
