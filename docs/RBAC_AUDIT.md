# RBAC Phase 1 — Complete Codebase Audit

> Generated from full codebase analysis. This document must be reviewed and confirmed before any schema changes.

---

## 1. Existing Role System

### 1.1 User Role Enum (lib/tenantModels.js)
```
admin              — Full platform access (company-level)
hr                 — HR functions
manager            — Team/project management
employee           — Regular employee (default)
department_head    — Department-level strategic authority
department_manager — Department operational management
team_leader        — Team-level execution authority
```

### 1.2 SuperAdmin (Separate Model — models/SuperAdmin.js)
- Stored in central `talio_superadmin` database (NOT tenant-scoped)
- Has its own permissions object: `canCreateCompanies`, `canDeleteCompanies`, `canManageSubscriptions`, `canManageSuperadmins`
- Authenticated via `lib/superadminAuth.js` — completely separate auth path

### 1.3 No Existing Role/Permission Model
There is **no separate `Role` or `Permission` model** in the codebase. Access control is entirely:
- The flat `user.role` string enum
- Hierarchy fields on User: `isDepartmentHead`, `headOfDepartments[]`, `isDepartmentManager`, `departmentManagerOf[]`, `teamLeaderOf[]`, `teamMemberOf[]`
- Hardcoded role arrays in individual API routes and components

---

## 2. Authentication & Authorization Architecture

### 2.1 Middleware (middleware.js)
- JWT verification with 5-minute in-memory cache (max 500 entries)
- Sets verified headers: `x-verified-user-id`, `x-verified-database`, `x-verified-email`, `x-verified-company-slug`, `x-verified-company-name`, `x-verified-role`
- Public routes bypass: `/`, `/login`, `/register`, `/forgot-password`, `/auth/*`, `/setup`, `/join`, `/download`
- Public API routes bypass: `/api/auth/*`, `/api/setup/*`, `/api/cron/`, `/api/health`, `/api/redis-status`, `/api/desktop/min-version`, `/api/assetlinks`, `/api/meetings/guest/`, `/api/notifications/config`
- SuperAdmin routes (`/superadmin/*`, `/api/superadmin/*`) bypass middleware entirely

### 2.2 Auth Functions (lib/auth.js)
- `getAuthAndModels(request, modelNames[])` — Primary API auth function. Returns `{ success, user, tenant, models }`
- `verifyTokenFromRequest(request)` — Token verification with tenant context
- `hasRole(user, allowedRoles[])` — Simple boolean role check
- `verifyToken(token)` — Raw JWT verification with caching

### 2.3 Hierarchy Auth (lib/hierarchyAuth.js)
- `hasDepartmentAuthority(user, departmentId, options)` — Checks admin/hr/dept_head/dept_manager
- `hasTeamAuthority(user, team)` — Checks admin/hr/dept authority/team_leader
- `getHierarchyLevel(user, departmentId)` — Returns hierarchy level string
- `canApproveLeave(user, employee)` — Leave approval authorization
- `canAssignTask(user, project, targetEmployeeId, userTeams)` — Task assignment rules
- `getProjectVisibilityFilter(user, models)` — MongoDB query filter

### 2.4 Client-Side Access Control
- `components/RoleBasedAccess.js` — Wrapper component that checks `rolePermissions` map and renders Access Denied screen
- `utils/roleBasedMenus.js` — Defines sidebar navigation items per role
- `components/Sidebar.js` — Dynamically extends menus based on `isDepartmentHead`/`teamLeaderOf`

---

## 3. Every Page in the App

### 3.1 Public / Auth Pages
| Route | Purpose | Access |
|-------|---------|--------|
| `/` | Root splash — redirect to `/dashboard` or `/login` | Public |
| `/login` | Email/password login | Public |
| `/auth/callback` | OAuth/SSO callback | Public |
| `/auth/change-password` | Change current password | Authenticated |
| `/auth/reset-password/[token]` | Token-based password reset | Public (token) |
| `/setup` | Initial org setup | Public |
| `/setup/[code]` | Tenant invitation setup | Public (code) |
| `/join/[guestLink]` | Guest meeting join | Public |
| `/join/[guestLink]/room` | Guest meeting room | Public |
| `/offline` | Offline fallback | Public |
| `/download` | Desktop app downloads | Public |
| `/resources` | Documentation | Public |

### 3.2 SuperAdmin Pages
| Route | Purpose | Access |
|-------|---------|--------|
| `/superadmin/login` | SuperAdmin login | Public |
| `/superadmin/dashboard` | Platform stats | SuperAdmin |
| `/superadmin/companies` | Company list | SuperAdmin |
| `/superadmin/companies/new` | Create company | SuperAdmin |
| `/superadmin/companies/[id]` | Company details | SuperAdmin |
| `/superadmin/analytics` | Platform analytics | SuperAdmin |
| `/superadmin/email` | Bulk email tool | SuperAdmin |
| `/superadmin/reminders` | Reminders management | SuperAdmin |

### 3.3 Dashboard Pages (Authenticated)

#### Dashboard Home
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard` | Unified dashboard with role-based KPIs | All roles |

#### Employees
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/employees` | Employee list | Admin, HR |
| `/dashboard/employees/add` | Add/bulk import employees | Admin, HR |
| `/dashboard/employees/edit/[id]` | Edit employee | Admin, HR |
| `/dashboard/employees/[id]` | View employee profile | Admin, HR, Manager |
| `/dashboard/employees/user-passwords` | Password management | Admin, HR |
| `/dashboard/employees/onboarding-emails` | Onboarding email campaigns | Admin, HR |

#### Attendance
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/attendance` | My attendance | All roles |
| `/dashboard/attendance/team` | Team attendance | Admin, HR, Dept Head |
| `/dashboard/attendance/checkins` | Employee check-ins | Admin, HR |
| `/dashboard/attendance/report` | Attendance report/export | Admin, HR |

#### Leave Management
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/leave` | Leave dashboard | All roles |
| `/dashboard/leave/apply` | Apply for leave | All roles |
| `/dashboard/leave/requests` | My leave requests | All roles |
| `/dashboard/leave/approvals` | Approve/reject leave | Manager, HR, Admin, Dept Head |
| `/dashboard/leave/allocations` | Leave quotas | Admin, HR |
| `/dashboard/leave/balance` | Leave balance charts | All roles |
| `/dashboard/leave-types` | Leave type management | Admin, HR |

#### Payroll
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/payroll` | Payroll dashboard | Admin, HR |
| `/dashboard/payroll/generate` | Generate payslips | Admin, HR |
| `/dashboard/payroll/payslips` | View payslips | All roles (own only for employee) |
| `/dashboard/payroll/payslips/[id]` | Payslip detail | Own/Admin/HR |

#### Projects & Tasks
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/projects` | All projects | All roles (filtered by membership) |
| `/dashboard/projects/create` | Create project | All roles |
| `/dashboard/projects/[projectId]` | Project details | Project members |
| `/dashboard/projects/[projectId]/edit` | Edit project | Project head, Admin |
| `/dashboard/projects/my-tasks` | My tasks | All roles |
| `/dashboard/projects/assigned-tasks` | Tasks assigned to me | All roles |
| `/dashboard/projects/approvals` | Task/project approvals | Project head, Admin |

#### Performance
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/performance` | Performance overview | Admin, HR |
| `/dashboard/performance/my-performance` | My performance | All roles |
| `/dashboard/performance/ratings` | Employee ratings | Admin, HR, Dept Head |
| `/dashboard/performance/reports` | Performance reports | Admin, HR, Dept Head |
| `/dashboard/performance/goals` | Goals list | Admin, HR, Manager, Dept Head |
| `/dashboard/performance/goals/create` | Create goal | Admin, HR |
| `/dashboard/performance/goals/[id]` | Goal detail | Admin, HR, Manager |
| `/dashboard/performance/goals/edit/[id]` | Edit goal | Admin, HR |

#### Team
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/team/members` | Team members list | All roles |
| `/dashboard/team/members/[id]` | Team member profile | All roles |
| `/dashboard/team/regularisation` | Attendance regularization | Admin, HR, Dept Head |

#### Recruitment
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/recruitment` | Job openings | Admin, HR |
| `/dashboard/recruitment/create` | Create job opening | Admin, HR |
| `/dashboard/recruitment/[id]` | Job opening details | Admin, HR |
| `/dashboard/recruitment/edit/[id]` | Edit job opening | Admin, HR |
| `/dashboard/recruitment/candidates` | Candidates list | Admin, HR, Manager |
| `/dashboard/recruitment/candidates/[id]` | Candidate profile | Admin, HR, Manager |
| `/dashboard/recruitment/interviews` | Interview management | Admin, HR, Manager |
| `/dashboard/recruitment/analytics` | Recruitment analytics | Admin, HR |

#### Helpdesk
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/helpdesk` | Support tickets | All roles |
| `/dashboard/helpdesk/[id]` | Ticket details | All roles |
| `/dashboard/helpdesk/manage` | Manage tickets | Admin, HR |

#### Learning & Development
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/learning` | Learning dashboard | All roles |
| `/dashboard/learning/courses` | Browse courses | All roles |
| `/dashboard/learning/trainings` | My trainings | All roles |
| `/dashboard/learning/certificates` | Certificates | All roles |

#### Chat & Communication
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/chat` | Direct messaging | All roles |
| `/dashboard/meetings` | Meetings list | All roles |
| `/dashboard/meetings/[id]` | Meeting details | All roles |
| `/dashboard/meetings/room/[roomId]` | Video room | Meeting participants |
| `/dashboard/announcements` | Announcements list | All roles |
| `/dashboard/announcements/create` | Create announcement | Admin, HR, Manager, Dept Head |
| `/dashboard/mail` | Email client | All roles |

#### Other Features
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/calendar` | Holiday/event calendar | All roles |
| `/dashboard/holidays` | Holiday management | Admin, HR (view: all) |
| `/dashboard/documents` | Personal documents | All roles |
| `/dashboard/expenses` | Submit expenses | All roles |
| `/dashboard/expenses/approvals` | Expense approvals | Manager, HR, Admin |
| `/dashboard/assets` | Asset management | Admin, HR |
| `/dashboard/designations` | Designation management | Admin, HR |
| `/dashboard/departments` | Department management | Admin, HR |
| `/dashboard/productivity` | MAYA AI analytics | Admin, HR, Dept Head, Team Leader |
| `/dashboard/admin/live-users` | Live user monitoring | Admin, HR, Dept Head |
| `/dashboard/reports` | Reports hub | All roles |
| `/dashboard/todo` | Personal to-dos | All roles |
| `/dashboard/talioboard` | Whiteboard | All roles |
| `/dashboard/sandbox` | Ideas/feature voting | All roles |
| `/dashboard/policies` | Company policies | All roles (manage: Admin/HR) |
| `/dashboard/app-info` | App diagnostics | All roles |
| `/dashboard/fcm-diagnostic` | Push notification testing | Dev |

#### Settings
| Route | Purpose | Current Access |
|-------|---------|----------------|
| `/dashboard/settings` | Settings hub | Admin |
| `/dashboard/settings/preferences` | Company preferences | Admin |
| `/dashboard/settings/notifications` | Notification rules | Admin |
| `/dashboard/settings/geofence-locations` | Geofence locations | Admin |

---

## 4. Every API Route and Current Protection

### 4.1 Public API Routes (No Auth)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth/login` | POST | User login |
| `/api/auth/register` | POST | User registration |
| `/api/auth/session` | GET, POST | Session check |
| `/api/auth/forgot-password` | POST | Password reset request |
| `/api/auth/reset-password/[token]` | GET, POST | Password reset |
| `/api/auth/google/callback` | GET | OAuth callback |
| `/api/setup/check` | GET | Setup status check |
| `/api/setup/create-admin` | POST | First admin creation |
| `/api/setup/tenant` | GET, POST | Tenant setup |
| `/api/health` | GET | Docker health check |
| `/api/redis-status` | GET, POST | Redis check |
| `/api/desktop/min-version` | GET | Desktop min version |
| `/api/assetlinks` | GET | Android deep links |
| `/api/test-imagekit` | GET | ImageKit test |

### 4.2 Cron Routes (CRON_SECRET)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/cron/auto-checkout` | POST | Midnight auto-checkout |
| `/api/cron/check-profile-deadlines` | POST | Profile deadline checks |
| `/api/cron/mark-absent` | POST | Mark absent employees |
| `/api/cron/process-email-queue` | POST | Send queued emails |
| `/api/cron/process-scheduled-notifications` | POST | Scheduled notifications |
| `/api/cron/subscription-reminders` | POST | License reminders |
| `/api/cron/todo-reminders` | POST | To-do reminders |
| `/api/cron/user-limit-check` | POST | License user limit |

### 4.3 SuperAdmin API Routes (superadminAuth)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/superadmin/auth/login` | POST | SuperAdmin login |
| `/api/superadmin/auth/session` | GET | Session validation |
| `/api/superadmin/analytics` | GET | Platform analytics |
| `/api/superadmin/stats` | GET | System statistics |
| `/api/superadmin/companies` | GET, POST | List/create companies |
| `/api/superadmin/companies/[id]` | GET, PUT, DELETE | Company CRUD |
| `/api/superadmin/companies/[id]/admin` | GET, POST | Company admin mgmt |
| `/api/superadmin/companies/[id]/reminders` | GET, POST, PATCH, DELETE | Company reminders |
| `/api/superadmin/companies/[id]/notes` | GET, POST, DELETE | Company notes |
| `/api/superadmin/companies/[id]/regenerate-setup-code` | POST | Reset setup code |
| `/api/superadmin/email` | GET, POST | Bulk email |
| `/api/superadmin/reminders` | GET, POST, PATCH, DELETE | Global reminders |

### 4.4 Tenant-Authenticated API Routes (getAuthAndModels)

#### Profile (Self-Only)
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/profile` | GET | Self |
| `/api/profile/picture` | POST, DELETE | Self |
| `/api/profile/sessions` | GET, DELETE | Self |
| `/api/profile/sessions/[id]` | DELETE | Self |
| `/api/profile/completion-status` | GET, POST | Self |
| `/api/profile/verify-aadhaar` | POST, GET | Self |
| `/api/profile/aadhaar-upload` | POST, GET | Self |

#### Employees
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/employees` | GET, POST | Any (filtered by role) |
| `/api/employees/list` | GET | Any |
| `/api/employees/[id]` | GET, PUT, DELETE, PATCH | Self/Admin/HR |
| `/api/employees/[id]/reviews` | GET, POST, DELETE | Admin/HR/Manager for POST |
| `/api/employees/managers` | GET | Any |
| `/api/employees/birthdays` | GET | Any |
| `/api/employees/bulk-import` | POST, GET | **Admin/HR** |
| `/api/employees/bulk-import/preview` | POST | **Admin/HR** |
| `/api/employees/send-onboarding-email` | POST | Any (self) |
| `/api/employees/onboarding-emails` | GET, PATCH | **Admin/HR** |
| `/api/employees/onboarding-emails/[id]` | POST, GET | **Admin/HR** |
| `/api/employees/onboarding-emails/queue-failed` | POST, GET | **Admin/HR** |
| `/api/employees/onboarding-emails/bulk-retry` | POST | **Admin/HR** |
| `/api/employees/user-passwords` | GET | **Admin/HR** |
| `/api/employees/user-passwords/reveal` | POST | **Admin/HR** |

#### Attendance
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/attendance` | GET, POST | Self/Admin/HR |
| `/api/attendance/[id]` | GET, PUT, DELETE | Self/Admin/HR |
| `/api/attendance/summary` | GET | Self/Admin/HR |
| `/api/attendance/checkins` | GET | **Admin** only |
| `/api/attendance/team-today` | GET | Admin/HR/DeptHead |
| `/api/attendance/geolocation-check` | POST | Any (geofence) |
| `/api/attendance/ip-location` | GET | Self |
| `/api/attendance/overtime` | GET, POST, PATCH | Self/Admin |
| `/api/attendance/corrections` | GET, POST, PATCH | Self/Admin/HR/Manager |
| `/api/attendance/audit` | GET | **Admin/HR** |
| `/api/attendance/fix-incomplete` | POST | **Admin/HR** |
| `/api/attendance/mark-absent` | POST, GET | **Admin/HR/DeptHead** |
| `/api/attendance/scheduler` | GET | Config check |

#### Leave
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/leave` | GET, POST | Any |
| `/api/leave/[id]` | GET, PUT, DELETE | Self/Approver |
| `/api/leave/balance` | GET | Self |
| `/api/leave/allocations` | GET, POST | **Admin/HR** |
| `/api/leave-types` | GET, POST, PUT, DELETE | **Admin/HR** for mutations |
| `/api/team/leave-approvals` | GET, POST | Manager/HR/DeptHead |
| `/api/team/pending-requests` | GET | Manager/HR/DeptHead |

#### Payroll
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/payroll` | GET, POST | **Admin/HR** |
| `/api/payroll/payslips` | GET | Any (own) / Admin/HR (all) |
| `/api/payroll/payslips/[id]` | GET, PUT, DELETE | Own/Admin/HR |
| `/api/payroll/generate` | POST | **Admin/HR** |
| `/api/payroll/send` | POST | **Admin/HR** |

#### Projects
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/projects` | GET, POST | Any (filtered) |
| `/api/projects/[projectId]` | GET, PUT, DELETE | Member/Head/Admin |
| `/api/projects/[projectId]/approval` | GET, POST, PATCH | ProjectHead/Admin |
| `/api/projects/[projectId]/analytics` | GET, POST | Member |
| `/api/projects/[projectId]/timeline` | GET, POST | Member |
| `/api/projects/approvals` | GET, POST | Member |
| `/api/projects/approvals/[requestId]` | GET, PUT, DELETE | ProjectHead/Admin |
| `/api/projects/approvals/[requestId]/task-completion` | GET, PUT | ProjectHead/Admin |
| `/api/projects/summary-ai` | GET | Member |
| `/api/projects/my-todo-tasks` | GET, POST | Self |
| `/api/projects/my-todo-tasks/[taskId]/advance-status` | PUT | Assignee |

#### Tasks
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/tasks` | GET | Any |
| `/api/tasks/[taskId]` | GET, PUT, DELETE | Creator/Assignee/Admin |
| `/api/tasks/[taskId]/assign` | POST | Admin/Creator |
| `/api/tasks/[taskId]/reassign` | POST | Creator |
| `/api/tasks/[taskId]/respond` | POST | Assignee |
| `/api/tasks/create` | POST | Any |
| `/api/tasks/assign` | POST, GET | Any (self-assign) |
| `/api/tasks/dashboard` | GET | Any |

#### Chat
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/chat` | GET | Self chats |
| `/api/chat/[chatId]` | GET | Member |
| `/api/chat/[chatId]/messages` | GET, POST | Member |
| `/api/chat/[chatId]/messages/[messageId]` | DELETE | Author |
| `/api/chat/[chatId]/messages/[messageId]/react` | POST | Member |
| `/api/chat/[chatId]/mark-read` | POST | Member |
| `/api/chat/[chatId]/leave` | POST | Member |
| `/api/chat/unread` | GET | Self |

#### Activity & Productivity
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/activity/team` | GET | **Admin/HR** (all), DeptHead (dept) |
| `/api/activity/manual-capture` | POST, GET | **Admin/HR/Manager/DeptHead/TeamLeader** |
| `/api/activity/clock-status` | GET | Self |
| `/api/activity/health` | GET | Any |
| `/api/activity/analysis` | GET, POST | Self/Admin/HR |
| `/api/activity/captures` | GET | **Admin/HR** |
| `/api/activity/screenshots` | GET | Self/DeptHead (dept) |
| `/api/activity/screenshot` | GET, POST | Self/Authorized |
| `/api/activity/screenshots/deduplicate` | POST, GET | **Admin/HR** |
| `/api/productivity/sessions` | GET, POST | Self |
| `/api/productivity/sessions/[id]` | GET, DELETE | Self |
| `/api/productivity/sessions/[id]/analyze` | GET | Self/DeptHead/Admin/HR |
| `/api/productivity/sessions/cleanup` | POST | **Admin/HR** |
| `/api/productivity/sessions/analyze-queue` | POST | **Admin/HR** |
| `/api/productivity/team` | GET | Admin/HR/DeptHead/TeamLeader |
| `/api/productivity/scores` | GET | Self/Admin/HR |

#### Dashboard API
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/dashboard/unified` | GET | All (filtered by role) |
| `/api/dashboard/manager-stats` | GET | Manager/HR/Admin |
| `/api/dashboard/hr-stats` | GET | **HR/Admin** |
| `/api/dashboard/employee-stats` | GET | Any |
| `/api/dashboard/ai-insights` | GET | Any |

#### Performance
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/performance` | GET, POST | Manager/Admin create |
| `/api/performance/[id]` | GET | Self/Manager/Admin |
| `/api/performance/task-stats` | GET | Any |
| `/api/performance/ratings` | GET | Any |
| `/api/performance/goals` | GET | Admin/HR/Manager/DeptHead/TeamLeader |
| `/api/performance/calculate` | GET | **Admin/HR** |
| `/api/performance/ai-insights` | GET | Admin/HR/DeptHead/Manager |
| `/api/performance/attendance-stats` | GET | **Admin/HR** |
| `/api/daily-goals` | GET, POST | Self |
| `/api/daily-goals/reminders` | GET, POST | Self |

#### Admin
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/admin/reactivate-user` | POST, GET | **Admin/HR** |
| `/api/admin/broadcast-refresh` | POST | **Admin** |
| `/api/admin/sync-department-heads` | GET, POST | **Admin** |
| `/api/admin/clear-chats` | DELETE | **Admin** |
| `/api/admin/live-users` | GET | Admin/HR/DeptHead |

#### Settings
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/settings/company` | GET, PUT | **Admin/HR** |
| `/api/settings/preferences` | GET, PUT | Self prefs / **Admin** for company |
| `/api/settings/screenshot-interval` | POST, GET | Self |
| `/api/policies` | GET, POST | All view / **Admin/HR** create |
| `/api/policies/[id]` | GET, PUT, DELETE | **Admin/HR** for mutations |
| `/api/policies/[id]/acknowledge` | POST | Self |

#### Announcements
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/announcements` | GET, POST | All view / **Admin/HR/Manager/DeptHead** create |
| `/api/announcements/[id]` | GET, PATCH, DELETE | **Admin/HR** for delete |

#### Meetings
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/meetings` | GET, POST | Any |
| `/api/meetings/[id]` | GET, PUT, DELETE | Participant/Creator |
| `/api/meetings/[id]/summary` | GET, POST | Creator/Admin |
| `/api/meetings/[id]/respond` | POST | Invitee |
| `/api/meetings/guest/*` | Various | Public (guest) |

#### Other
| Route | Methods | Role Restriction |
|-------|---------|-----------------|
| `/api/geofence/locations` | GET, POST | All view / **Admin/HR** create |
| `/api/geofence/locations/[id]` | GET, PUT, DELETE | **Admin/HR** |
| `/api/geofence/log` | GET, POST | Self |
| `/api/geofence/approve` | POST | **Admin/HR** |
| `/api/holidays` | GET, POST | All view / **Admin/HR** create |
| `/api/holidays/[id]` | GET, PUT, DELETE | **Admin/HR** |
| `/api/holidays/fetch-ai` | POST | **Admin/HR** |
| `/api/designations` | GET, POST | **Admin/HR** |
| `/api/departments` | GET, POST | **Admin/HR** |
| `/api/departments/[id]/manager` | GET, PUT | **Admin/HR/DeptHead** |
| `/api/recruitment` | GET, POST | **Admin/HR** |
| `/api/recruitment/[id]` | GET, PUT, DELETE | **Admin/HR** |
| `/api/recruitment/interviews` | GET, POST | **Admin/HR/Manager** |
| `/api/recruitment/candidates` | GET, POST | **Admin/HR/Manager** |
| `/api/recruitment/candidates/[id]` | GET, PATCH | **Admin/HR/Manager** |
| `/api/recruitment/analytics` | GET | **Admin/HR** |
| `/api/expenses` | GET, POST | Self |
| `/api/expenses/[id]` | PUT, DELETE | **Admin/Manager** approve |
| `/api/actionable-notifications` | GET, POST | **Admin/HR** |
| `/api/mail` | GET, POST, DELETE | Self |
| `/api/mail/messages` | GET, POST, PATCH, DELETE | Self |
| `/api/mail/labels` | GET, POST, DELETE | Self |
| `/api/mail/compose-ai` | POST | Self |
| `/api/personal-todos` | GET, POST | Self |
| `/api/personal-todos/*` | Various | Self |
| `/api/whiteboard` | GET, POST | Self |
| `/api/whiteboard/[id]` | GET, PUT, DELETE | Owner/Shared |
| `/api/celebrations/today` | GET | Any |
| `/api/push-notifications/send` | POST | **Admin/HR** |
| `/api/push-subscriptions` | GET, POST | Self |
| `/api/sidebar/counts` | GET | Any |
| `/api/search` | GET | Any |
| `/api/users` | GET | Any (filtered) |
| `/api/users/search` | GET | Any |
| `/api/users/[userId]/send-reset-link` | POST | **Admin/HR** |
| `/api/webhooks` | GET, POST | **Admin** |
| `/api/upload` | POST | Any |
| `/api/uploads/aadhaar/[...path]` | GET | Self/Admin/HR |
| `/api/user/heartbeat` | POST, GET | Any |
| `/api/user/check-refresh` | GET | Any |
| `/api/assets` | GET, POST | **Admin/HR** manage |
| `/api/learning/*` | Various | All view / **Admin/HR** manage |
| `/api/helpdesk` | GET, POST | Any |
| `/api/helpdesk/[id]` | GET, PUT | Any (manage: Admin/HR) |
| `/api/teams` | GET, POST | **Admin/HR/DeptHead/DeptManager** create |
| `/api/teams/[teamId]` | GET, PATCH, DELETE | **Admin/HR/DeptHead** |
| `/api/teams/[teamId]/members` | GET, POST | **Admin/HR/DeptHead/DeptManager/TeamLeader** |
| `/api/teams/[teamId]/leaders` | GET, PUT | **Admin/HR/DeptHead/DeptManager** |
| `/api/notifications/*` | Various | Self/Admin |
| `/api/call-alert/*` | Various | Any (participants) |
| `/api/tictactoe` | GET, POST | Any |
| `/api/maya/*` | Various | Self/AI system |

---

## 5. Sidebar Navigation Items Per Role

### 5.1 Current Role-Based Menu Structure (utils/roleBasedMenus.js)

**Admin & HR** — Full access (identical menus):
- Main: Dashboard, Chat, Mail, Meetings, To-Do's, TalioBoard
- Work: Projects (All/My Tasks/Assigned/Approvals/Create), Attendance & Leaves (full set), Productivity
- People: Employees (All/Add/Onboarding/Depts/Designations/Passwords), Live Users, Performance (full), Recruitment (full)
- Finance: Payroll (Process/Generate/Payslips), Expenses (My/Approvals)
- Resources: Documents, Assets, Helpdesk, Policies, Ideas, Learning (Courses/Trainings/Certificates)
- Company: Announcements (All/Create), Holidays, Calendar

**Manager:**
- Main: Dashboard, Chat, Mail, Meetings, To-Do's, TalioBoard
- Work: Projects (full), Attendance & Leaves (personal + approvals)
- Finance: Payslips, Expenses (My/Approvals)
- Resources: Documents, Assets, Policies, Learning (Trainings/Certificates), Helpdesk, Ideas
- Company: Announcements (view), Calendar

**Department Head:**
- Same as Manager PLUS: Productivity, Live Users, Team Attendance, Regularisation
- Dynamic: Team section (Members, Ratings, Goals, Reports, Geofencing)
- If also Team Leader: My Teams sub-item

**Employee:**
- Main: Dashboard, Chat, Mail, Meetings, To-Do's, TalioBoard
- Work: Projects (My Projects/My Tasks/Assigned/Approvals/Create), Attendance (personal), Leave (personal)
- Finance: Payslips, Expenses (My/Approvals)
- Resources: Documents, Assets, Policies, Learning (Trainings/Certificates), Helpdesk, Ideas
- Company: Announcements (view), Calendar

### 5.2 Client-Side Route Permissions (RoleBasedAccess.js)
Each role has an explicit array of allowed `/dashboard/*` paths. Admin has `['*']` (wildcard).

### 5.3 Mobile Bottom Nav (BottomNav.js)
5 fixed items for all roles: Home, Projects, Chat, Leave, Ideas

---

## 6. Role Check Patterns in the Codebase

### 6.1 Pattern: `hasRole(user, roles)` (lib/auth.js)
Used in: ~10 API routes (teams, departments)

### 6.2 Pattern: `ADMIN_ROLES = ['admin', 'hr']`
Most common pattern. Used in 20+ routes for employee management, payroll, settings, etc.

### 6.3 Pattern: `ALLOWED_ROLES = ['admin', 'hr', 'manager']`
Used in recruitment, some broader features.

### 6.4 Pattern: Direct `user.role ===` checks
Used in 20+ files for role-specific behavior (different queries per role, conditional data access).

### 6.5 Pattern: Hierarchy checks via `lib/hierarchyAuth.js`
Used in projects, tasks, teams, activity/productivity, leave approvals.

### 6.6 Pattern: `isDepartmentHead` / `teamLeaderOf` field checks
Used for dynamic sidebar extensions and conditional API access.

---

## 7. Key Findings & Risks for RBAC Implementation

### 7.1 No Centralized Permission System
- Permissions are hardcoded in every file as role arrays
- No single source of truth for "what can role X do?"
- Adding a new role requires editing dozens of files

### 7.2 Inconsistent Role Coverage
- `department_manager` role exists in enum but has **no sidebar menu** and **no RoleBasedAccess entry**
- `team_leader` has RoleBasedAccess routes but **no entry in roleBasedMenus.js** (handled dynamically in Sidebar)
- `department_head` is **not in roleBasedMenus.js** either — uses dynamic sidebar logic

### 7.3 Duplicate Authorization Logic
- API routes have their own role checks
- RoleBasedAccess.js has a separate permission matrix
- roleBasedMenus.js has a third definition of role access
- These three can (and do) drift out of sync

### 7.4 Hierarchy Fields as Pseudo-Permissions
- `isDepartmentHead`, `headOfDepartments`, `isDepartmentManager`, `departmentManagerOf`, `teamLeaderOf` function as implicit permissions that bypass the role enum
- These need to be accounted for in any RBAC design

### 7.5 SuperAdmin is Completely Separate
- Different auth path, different database, different model
- RBAC system should NOT touch SuperAdmin — it should remain isolated

### 7.6 No Audit Trail
- No logging of role changes, permission changes, or access denied events
- `isActive` field has pre-save hooks for audit logging, but no equivalent for role

---

## 8. Statistics Summary

| Category | Count |
|----------|-------|
| Distinct roles in enum | 7 |
| Total pages in app | ~80 dashboard + ~15 public/auth/superadmin |
| Total API routes | ~200+ |
| API routes with role checks | ~60 |
| API routes with only auth (no role check) | ~140 |
| Files with hardcoded role arrays | ~40+ |
| Sidebar menu definitions per role | 4 (admin, hr, manager, employee) + 2 dynamic (dept_head, team_leader) |

---

*This audit is the foundation for all RBAC implementation phases. Please review and confirm accuracy before proceeding to Phase 2.*
