# Slow API Tracking — 30 September 2026

Source-level audit of `/app/api/**/route.js` (381 route files). Not a production
latency benchmark. Covers request-path cost only.

## Severity key
- 🔴 Hot path with unbounded work / N+1 across large collections
- 🟠 Blocking external service in the request path
- 🟡 Missing pagination or heavy population

## Tracked slow routes

| # | Route | Method | Pattern | Severity | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| 1 | `/api/team/members` | GET | N+1 `Employee.findById` per dept head | 🔴 | `Employee.find({ _id: { $in: ids } }).populate(...)` |
| 2 | `/api/performance/calculate` | GET/POST | N+1 per employee (2 queries each) | 🔴 | Grouped `$in` queries / aggregate |
| 3 | `/api/projects` | GET | N+1 `getTaskStats` per project | 🔴 | `Task.aggregate` with `$in` + `$group` |
| 4 | `/api/attendance/corrections` | GET | Unbounded find + sequential permission queries | 🔴 | `.limit()`; `Promise.all` lookups |
| 5 | `/api/chat` | GET | Unbounded chats + nested `messages.sender` populate | 🔴 | Paginate; populate latest message only |
| 6 | `/api/meetings` | GET | Per-meeting external availability refresh | 🟠 | Batch presence; skip non-online |
| 7 | `/api/call-alert` | POST | Sequential ElevenLabs TTS per receiver | 🟠 | Parallelize / background |
| 8 | `/api/announcements/[id]` | PUT | All-users find + blocking bulk push | 🟠 | Defer via `after()` |
| 9 | `/api/policies/[id]` | PUT | All-users find + blocking bulk push | 🟠 | Defer via `after()` |
| 10 | `/api/policies` | POST | All-users find + blocking bulk push | 🟠 | Defer via `after()` |
| 11 | `/api/meetings/[id]/summary` | POST | Blocking LLM + MOM email fan-out | 🟠 | Stream/async; background MOM |
| 12 | `/api/payroll/bulk` | POST | Email per payroll in request path | 🟠 | Queue emails |
| 13 | `/api/employees/[id]/probation-approval` | POST | Blocking email before response | 🟠 | Defer via `after()` |
| 14 | `/api/notifications/send` | POST | Unbounded `User.find({})` + bulk push | 🟠 | Stream/limit; defer |
| 15 | `/api/notifications/process` | POST | Unbounded `User.find({})` | 🟠 | Chunk |
| 16 | `/api/search` | GET | 8 sequential regex `.find` categories | 🟠 | `Promise.all` categories |
| 17 | `/api/performance/appraisals` | GET | `.limit(500)` + 8 populates, in-memory slice | 🟡 | Server-side pagination; trim fields |
| 18 | `/api/users` | GET | Unbounded `User.find({}).select('+password')` | 🟡 | Paginate; drop `+password` |
| 19 | `/api/celebrations/today` | GET | Loads all active employees, JS filter | 🟡 | `$expr` month/day filter |
| 20 | `/api/hierarchy/tree` | GET | Full active employee + user load | 🟡 | Cap depth / projection |
| 21 | `/api/attendance/checkins` | GET | Unbounded active employee scan | 🟡 | Aggregate with date `$match` |
| 22 | `/api/documents` | GET | Unbounded find + sequential awaits | 🟡 | Paginate; `Promise.all` |
| 23 | `/api/geofence/locations` | GET | Unbounded find + 3 populates | 🟡 | `.limit()` |
| 24 | `/api/companies` | GET | Unbounded find | 🟡 | Minor |
| 25 | `/api/designations` | GET | Unbounded find | 🟡 | Minor |
| 26 | `/api/leave/types` | GET | Unbounded find | 🟡 | Minor |
| 27 | `/api/ai/mira-attachments`, `mira-computer`, `mira-navigation-snapshot` | POST | Blocking `sharp` image processing | 🟠 | Offload |
| 28 | `/api/productivity/composite/image` | POST | Blocking `sharp` image processing | 🟠 | Offload |
| 29 | Single-recipient blocking FCM push routes: `geofence/approve`, `leave/[id]`, `leave/[id]/action`, `payroll`, `payroll/[id]`, `expenses/[id]`, `documents/[id]`, `helpdesk/[id]/comments`, `focus-timer/complete` | POST/PATCH/PUT | Blocking push in request path | 🟠 | Defer via `after()` |

## Missing indexes (systemic, affects nearly every authenticated endpoint)

`EmployeeSchema` (`lib/tenantModels.js`) has no index on `userId`, `user`, or `email`.
`Employee.findOne({ userId })` / `Employee.findOne({ user })` is a collection scan
in 16+ routes (`meetings`, `whiteboard`, `profile/picture`, `leave/balance`,
`team/check-head`, …).

Fix: `EmployeeSchema.index({ userId: 1 })`, `EmployeeSchema.index({ user: 1 })`,
`EmployeeSchema.index({ email: 1 })`, plus `employeeCode` for payslips.

## Already measured (`Server-Timing` header)

- `ai/mira-chat` (`mira_context`)
- `ai/mira-images` (`image_generation`, `image_storage`)
- `attendance` (`attendance`)
- `meetings` (`meeting-create`)
- `whiteboard` (`board-create`)

`attendance/route.js` defers `sendEmail`/`sendPushToUser`/`reverseGeocode` via
`after()` (`lib/attendancePostResponse.js`) — the template for the blocking
push/email routes above.
