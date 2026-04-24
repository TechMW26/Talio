# Superadmin Dashboard Guide

Last verified: 2026-04-10

## Purpose

This document explains how Talio's superadmin dashboard works, how tenant companies are created, how the first tenant admin is onboarded, and how later users are added inside each tenant.

This is the platform control-plane view of the product. It is separate from the normal tenant dashboard used by company admins and employees.

## 1. Big Picture

Talio runs on a multi-tenant model with two database layers:

| Layer | Database | What it stores |
| --- | --- | --- |
| Platform control plane | `talio_superadmin` | Superadmin accounts, tenant company records, setup codes, reminders, notes, tenant login mapping |
| Tenant data plane | `talio_company_{slug}` | Each company's users, employees, departments, meetings, attendance, chat, payroll, and all day-to-day product data |

The superadmin dashboard manages companies at the platform level. It does not directly use tenant middleware auth. Instead, it has its own auth system built around:

- `superadmin_token` in browser localStorage
- `/api/superadmin/*` routes guarded by `lib/superadminAuth.js`
- `SuperAdmin` records stored in `talio_superadmin`

## 2. High-Level Flow

The intended company lifecycle is:

1. Seed the first root superadmin.
2. Superadmin logs into `/superadmin/login`.
3. Superadmin creates a company from `/superadmin/companies/new`.
4. The platform creates a `TenantCompany` record, generates a `databaseName`, and issues a single-use `setupCode`.
5. The setup URL is shared with the company's primary contact.
6. The first tenant admin opens `/setup/{code}` and creates their admin account.
7. That action creates the first `Employee` and `User` in the tenant database, marks setup complete, and adds a central `UserTenantMapping` entry.
8. After that, tenant admins can create employees and user accounts from the tenant app.

There is also a fallback platform path where a superadmin can create tenant admins directly from the company detail page without waiting for the setup-code flow.

## 3. Superadmin UI Structure

### Main route tree

| Path | Purpose |
| --- | --- |
| `app/superadmin/layout.js` | Shared superadmin shell with sidebar, auth/session validation, logout, and page container |
| `app/superadmin/page.js` | Entry page that routes into the login flow |
| `app/superadmin/login/page.js` | Superadmin login form |
| `app/superadmin/dashboard/page.js` | Top-level overview with counts, recent companies, and quick actions |
| `app/superadmin/companies/page.js` | Searchable/filterable company list |
| `app/superadmin/companies/new/page.js` | New-company creation form |
| `app/superadmin/companies/[id]/page.js` | Company detail view with admin management, subscription editing, notes, reminders, email, and setup actions |
| `app/superadmin/analytics/page.js` | Cross-company analytics and storage/revenue view |
| `app/superadmin/reminders/page.js` | Upcoming and overdue company reminders |
| `app/superadmin/email/page.js` | Manual outbound email and template-driven communication |

### Layout and session model

`app/superadmin/layout.js` is the main shell for the portal.

It does three important things:

1. Skips the shell for `/superadmin/login`.
2. Reads `superadmin_token` and `superadmin_user` from localStorage.
3. Calls `/api/superadmin/auth/session` on page load to verify the token before rendering the portal.

The sidebar navigation currently exposes:

- Dashboard
- Companies
- Analytics
- Email
- Reminders

Logout simply clears `superadmin_token` and `superadmin_user` from localStorage and redirects back to `/superadmin/login`.

### Dashboard page

`app/superadmin/dashboard/page.js` fetches `/api/superadmin/stats` and renders:

- Total companies
- Active companies
- Pending setup companies
- Overdue reminders
- Subscription plan distribution
- Expiring and expired subscriptions
- Recent companies
- Quick action shortcuts

This page is a snapshot view of platform health. It is not tenant-specific.

### Companies list page

`app/superadmin/companies/page.js` is the main operational list for tenant accounts.

It supports:

- Search by company name, slug, primary contact name, or primary contact email
- Filter by service status
- Filter by subscription status
- Quick stats bar for total, active, pending setup, and suspended companies

Each card links to the company detail page.

### New company page

`app/superadmin/companies/new/page.js` is the full onboarding form for a tenant company.

The form is split into these tabs:

- Basic Info
- Contact and Address
- Business Details
- Plan and Subscription
- Features
- Onboarding Payment

This page also:

- Auto-generates the slug from company name if needed
- Shows the derived tenant database name preview
- Applies plan templates from `lib/planFeatures`
- Lets superadmin override feature flags and user/storage limits
- Copies the generated setup URL to the clipboard after company creation

### Company detail page

`app/superadmin/companies/[id]/page.js` is the operational control center for a single tenant company.

Based on the current component state and API calls, this page handles:

- Company overview
- Subscription editing
- Admin management
- Setup-code regeneration
- Internal notes
- Internal reminders
- Manual email sending
- Company deletion actions

Important admin-management actions on this page:

- List current tenant admins
- Create a new admin in the tenant database
- Reset an admin password
- Toggle admin active/inactive state

## 4. Superadmin API Structure

All `app/api/superadmin/*` routes use `verifySuperAdmin(request)` from `lib/superadminAuth.js`.

### Auth routes

| Route | Method | Purpose |
| --- | --- | --- |
| `app/api/superadmin/auth/login/route.js` | `POST` | Validates superadmin email/password and issues a JWT with `isSuperAdmin: true` |
| `app/api/superadmin/auth/session/route.js` | `GET` | Validates an existing superadmin token for layout/session checks |

### Company routes

| Route | Method | Purpose |
| --- | --- | --- |
| `app/api/superadmin/companies/route.js` | `GET` | List companies with filters and aggregate stats |
| `app/api/superadmin/companies/route.js` | `POST` | Create a tenant company, generate setup code, return setup URL |
| `app/api/superadmin/companies/[id]/route.js` | `GET` | Fetch full company details |
| `app/api/superadmin/companies/[id]/route.js` | `PATCH` | Update subscription, features, notes, status, and company settings |
| `app/api/superadmin/companies/[id]/route.js` | `DELETE` | Company deletion path used by the detail page |
| `app/api/superadmin/companies/[id]/regenerate-setup-code/route.js` | `POST` | Issue a fresh setup code and setup URL |

### Admin routes

| Route | Method | Purpose |
| --- | --- | --- |
| `app/api/superadmin/companies/[id]/admin/route.js` | `GET` | List admin users from the tenant database |
| `app/api/superadmin/companies/[id]/admin/route.js` | `POST` | Create an admin `Employee` + `User` directly in the tenant database |
| `app/api/superadmin/companies/[id]/admin/route.js` | `PATCH` | Reset password, toggle active state, or force password change |

### Company activity routes

| Route | Method | Purpose |
| --- | --- | --- |
| `app/api/superadmin/companies/[id]/notes/route.js` | `GET`, `POST` | Read and add internal notes |
| `app/api/superadmin/companies/[id]/reminders/route.js` | `GET`, `POST`, `PATCH` | Read, add, and update company reminders |

### Dashboard and communication routes

| Route | Method | Purpose |
| --- | --- | --- |
| `app/api/superadmin/stats/route.js` | `GET` | Dashboard cards and recent-company summary |
| `app/api/superadmin/analytics/route.js` | `GET` | Platform-wide analytics including live storage stats per tenant DB |
| `app/api/superadmin/reminders/route.js` | `GET` | Upcoming and overdue reminders across all companies |
| `app/api/superadmin/email/route.js` | `GET` | Returns canned email templates |
| `app/api/superadmin/email/route.js` | `POST` | Sends manual emails to a company or any specified recipient |

## 5. Core Models and Helpers

### `models/SuperAdmin.js`

This model stores platform administrators.

Core fields include:

- `email`
- `password` (hashed)
- `name`
- `isActive`
- `lastLogin`
- permissions such as:
  - `canCreateCompanies`
  - `canDeleteCompanies`
  - `canManageSubscriptions`
  - `canManageSuperadmins`

### `models/TenantCompany.js`

This is the master record for each tenant company in the superadmin database.

It stores:

- Company identity: `name`, `slug`, `description`, `logo`
- Primary contact information
- Business and billing details
- `databaseName`
- `setupCode`
- `isSetupComplete`
- `subscription`
- `features`
- `miraTokens`
- onboarding payment details
- payment history
- service status
- notes
- reminders
- analytics fields
- email history

Two important built-in behaviors:

1. `generateSetupCode(expiresInDays = 7)` creates a single-use code with expiry.
2. A `pre('validate')` hook converts the company slug into `databaseName = talio_company_{sanitizedSlug}`.

### `models/UserTenantMapping.js`

This is the bridge between the control plane and tenant login.

It stores a lookup row per email with fields such as:

- `email`
- `tenantCompanyId`
- `databaseName`
- `companyName`
- `companySlug`
- `role`
- `isActive`
- `userId` when available
- login stats

This mapping is how the normal tenant login route discovers which tenant database to use for a given email address.

### `lib/superadminAuth.js`

This helper verifies the platform JWT and ensures the caller is actually a superadmin.

It checks:

- Authorization header exists
- JWT is valid
- `payload.isSuperAdmin` is true
- Superadmin record exists and is active

### `lib/tenantContext.js`

This file is one of the most important multi-tenant bridges in the repo.

It provides:

- `getTenantByEmail(email)`
- `getTenantByUserId(userId)`
- `getTenantBySlug(slug)`
- `validateSetupCode(setupCode)`
- `markSetupCodeUsed(companyId, email)`
- `registerUserTenantMapping(...)`
- `updateUserLoginStats(email)`
- `checkServiceStatus(databaseName)`
- `checkUserLimit(databaseName)`
- `getTenantCompanyByDbName(databaseName)`

### `lib/tenantModels.js`

This helper binds Mongoose models to a specific tenant connection.

It is the correct way to load tenant-scoped models like `User`, `Employee`, `Department`, and so on.

### `lib/auth.js`

This is the standard tenant-auth helper for normal app APIs.

For authenticated tenant routes, the repo convention is:

- Use `getAuthAndModels(request, [...])`
- Do not import tenant models directly from `models/*`

That is the main tenant-isolation guardrail.

## 6. Authentication Model

### Superadmin auth

Superadmin login is completely separate from tenant login.

Flow:

1. `app/superadmin/login/page.js` posts email/password to `app/api/superadmin/auth/login/route.js`.
2. The API loads `SuperAdmin`, verifies password, updates `lastLogin`, and signs a JWT with `isSuperAdmin: true`.
3. The browser stores:
   - `superadmin_token`
   - `superadmin_user`
4. `app/superadmin/layout.js` later validates that token via `/api/superadmin/auth/session`.

### Middleware behavior

`middleware.js` explicitly bypasses both:

- `/superadmin/*`
- `/api/superadmin/*`

This means superadmin routes are not protected by the normal tenant middleware flow. They rely on:

- client-side session handling for pages
- `verifySuperAdmin()` in the API layer

### Tenant auth

Normal tenant users do not log in through the superadmin system.

`app/api/auth/login/route.js` does the following:

1. Takes the submitted email.
2. Calls `getTenantByEmail(email)`.
3. Uses `UserTenantMapping` to resolve the correct `databaseName`.
4. Checks service status for that company.
5. Loads the correct tenant `User` model via `getTenantModels(databaseName, ...)`.
6. Verifies password and signs a tenant JWT that includes `databaseName`.

This means a user can exist in a tenant DB but still be unable to log in if there is no matching `UserTenantMapping` row.

## 7. Company Creation Flow

The main company-creation route is `app/api/superadmin/companies/route.js`.

### What happens when a company is created

1. Superadmin submits the form from `app/superadmin/companies/new/page.js`.
2. The API verifies superadmin auth and checks `canCreateCompanies` permission.
3. The request validates:
   - `name`
   - `slug`
   - `primaryContact.name`
   - `primaryContact.email`
4. The slug is checked against the expected format:
   - lowercase
   - alphanumeric plus hyphen
   - no leading or trailing hyphen
5. A new `TenantCompany` record is created.
6. The model derives `databaseName` from the slug.
7. The route calls `company.generateSetupCode(7)`.
8. The route computes a setup URL using `NEXT_PUBLIC_APP_URL`.
9. The response returns the new company plus:
   - `setupCode`
   - `setupUrl`

### Important output fields

When a company is created, these generated fields matter the most:

- `slug`
- `databaseName`
- `setupCode.code`
- `setupCode.expiresAt`
- `isSetupComplete = false`

### What is not created yet

Creating a `TenantCompany` record does not create the first tenant admin automatically.

It also does not guarantee that the tenant database already contains real business data. The tenant DB becomes meaningful once admin and employee records start being created there.

## 8. First Admin Onboarding Flow

The setup-code flow lives in `app/api/setup/tenant/route.js` and `app/setup/[code]/page.js`.

### GET: validate the setup code

The setup page first calls:

- `GET /api/setup/tenant?code={setupCode}`

That route:

1. Calls `validateSetupCode(code)`.
2. Confirms the code exists.
3. Confirms it is not already used.
4. Confirms it is not expired.
5. Returns the company name and slug for display on the setup screen.

### POST: create the first tenant admin

When the user submits the setup form, the API:

1. Re-validates `setupCode`.
2. Connects to the tenant database using `company.databaseName`.
3. Loads the tenant `User` model via `getTenantModels`.
4. Creates the first `Employee` record with:
   - `employeeCode = ADMIN-001`
   - name and email from the setup form
   - active status
5. Creates the first `User` record with:
   - `role = admin`
   - `employeeId` pointing to that employee
   - `forcePasswordChange = false`
6. Calls `markSetupCodeUsed(company.id, email)`.
7. Calls `registerUserTenantMapping(...)`.
8. Returns a tenant JWT so the new admin can enter the normal dashboard.

### What changes in the superadmin DB after successful setup

After first admin creation:

- `setupCode.isUsed = true`
- `setupCode.usedAt` is set
- `setupCode.usedByEmail` is set
- `isSetupComplete = true`
- `setupCompletedAt` is set
- a `UserTenantMapping` row exists for the admin email

## 9. Direct Admin Creation from Superadmin

The company detail page can also create admins directly through:

- `POST /api/superadmin/companies/[id]/admin`

This route is useful when:

- the company setup link was never used
- support needs to create an admin manually
- a company needs more admin accounts after setup

### What the route does

1. Verifies superadmin auth.
2. Loads the `TenantCompany` record.
3. Connects to the tenant DB.
4. Ensures a tenant `Company` record exists in that DB.
5. Creates an `Employee` record for the admin.
6. Creates a tenant `User` with:
   - `role = admin`
   - `forcePasswordChange = true`
7. Upserts a `UserTenantMapping` row.
8. If the company was not yet set up, it marks setup complete and consumes the setup code at this point.

### Related admin-management actions

The same route supports later admin maintenance:

- `GET` to list admins
- `PATCH` to reset password
- `PATCH` to toggle `isActive`
- `PATCH` to toggle `forcePasswordChange`

## 10. How Normal Users Are Added Later

After the first tenant admin is in place, user creation moves into the tenant application.

### Important distinction: Employee vs User

Talio uses two separate records for a person:

| Record | Purpose |
| --- | --- |
| `Employee` | HR profile, org structure, designation, reporting, salary, department, profile fields |
| `User` | Login account, password, role, force-password-change flags, session/auth identity |

Most onboarding flows create both together.

### Single employee creation

The main route is:

- `app/api/employees/route.js` `POST`

This route:

1. Uses `getAuthAndModels(request, ['Employee', 'User', ...])`.
2. Enforces tenant context.
3. Checks the tenant user limit through `checkUserLimit(databaseName)`.
4. Creates the `Employee` record.
5. Creates the related tenant `User` record.
6. Updates the employee with the new `userId`.
7. Registers a `UserTenantMapping` row in the superadmin DB.
8. Starts backup sync and related onboarding side effects.

This route is the normal tenant-side employee onboarding path.

### Bulk import

The bulk onboarding route is:

- `app/api/employees/bulk-import/route.js`

This route is more advanced and supports:

- Excel parsing via `xlsx`
- AI-assisted column mapping
- spelling cleanup for department and designation values
- auto-generated temporary passwords
- encrypted storage of onboarding password for admin visibility
- `forcePasswordChange = true`
- onboarding emails
- `UserTenantMapping` registration for each created user

This is the best route when a tenant needs to bring in many employees at once.

### Role assignment in bulk import

The bulk-import path derives roles from designation/department using helper logic inside the route.

Current behavior maps imported users into roles such as:

- `employee`
- `hr`
- `manager`

It does not treat imported users as tenant admins by default.

## 11. Why `UserTenantMapping` Matters So Much

`UserTenantMapping` is the central lookup table that tells Talio where a user's account lives.

Without it, tenant login cannot determine which tenant DB to open.

That is why all user-creation paths that should allow login must eventually call `registerUserTenantMapping(...)`.

In the current codebase, that happens in at least these flows:

- setup-code first admin creation
- superadmin-created tenant admin creation
- tenant-side single employee creation
- tenant-side bulk employee import

## 12. Analytics, Reminders, and Email

### Analytics

`app/api/superadmin/analytics/route.js` provides a broader cross-company view than the dashboard card API.

It currently calculates or returns:

- total, active, paused, and suspended company counts
- live storage used per tenant DB
- document counts per tenant DB
- expiring and expired subscriptions
- plan distribution
- monthly recurring revenue estimate
- total onboarding revenue

### Reminders

There are two reminder layers:

1. Company-specific reminders stored on `TenantCompany.reminders`
2. Global reminder view from `app/api/superadmin/reminders/route.js`

The global reminder route flattens pending reminders across all companies, sorts by due date, and returns:

- total reminders
- overdue reminders
- upcoming reminders

### Email

`app/api/superadmin/email/route.js` supports both template retrieval and manual sending.

Current template types include:

- subscription reminder
- payment received
- user limit warning
- welcome email
- service paused notification

The API can send to any recipient, and when a `companyId` is provided it also logs communication activity against that company record.

## 13. Operational Playbooks

### A. Onboard a brand-new client company

1. Log into `/superadmin/login`.
2. Open `/superadmin/companies/new`.
3. Fill basic company, contact, subscription, feature, and onboarding payment details.
4. Create the company.
5. Copy the generated setup URL.
6. Send that setup URL to the customer's primary contact.
7. Wait for first admin to finish setup or create the admin manually from the company detail page if needed.

### B. Create a second admin for an existing company

1. Open `/superadmin/companies/{id}`.
2. Go to the admins section.
3. Submit the new admin's name, email, password, and phone.
4. The platform creates an `Employee`, a `User`, and a `UserTenantMapping` entry.

### C. Reset a tenant admin password

1. Open the company detail page.
2. Find the target admin.
3. Trigger the reset password action.
4. The admin route updates the password and turns on `forcePasswordChange`.

### D. Recover an expired or lost setup link

1. Open the company detail page.
2. Regenerate the setup code.
3. Copy the new setup URL.
4. Share the new link with the customer.

### E. Add normal employees after tenant setup is complete

1. Log in as the tenant admin to the normal company dashboard.
2. Use the tenant employee creation flow or bulk-import flow.
3. Ensure each created user is allowed to log in by verifying the route also created a `UserTenantMapping` row.

## 14. Important Rules and Gotchas

1. Superadmin auth and tenant auth are separate systems.

2. `/superadmin/*` and `/api/superadmin/*` are intentionally bypassed by normal middleware checks. Superadmin API protection is done inside `verifySuperAdmin()`.

3. `databaseName` is derived from the company slug. Changing a slug later is not just a cosmetic change because it is tied to tenant DB identity.

4. `setupCode` is single-use and time-bound. Once consumed, the company is considered set up.

5. Creating a `TenantCompany` does not create the first login user. That only happens during setup-code onboarding or direct admin creation.

6. `Employee` and `User` are different records. Creating only one of them is not enough for a fully functioning person account.

7. `UserTenantMapping` is mandatory for tenant login routing. If the mapping is missing, login by email will fail even if a user exists inside the tenant database.

8. For normal tenant APIs, always use `getAuthAndModels()` and tenant-aware models. Do not directly import tenant models into authenticated tenant API routes.

9. Service status can block tenant access. `checkServiceStatus(databaseName)` can deny login for paused, suspended, or terminated companies.

10. The single employee-create route explicitly checks subscription user limits. Any other onboarding path should be reviewed with that in mind when changing behavior.

## 15. File Reference Index

### Superadmin pages

- `app/superadmin/layout.js`
- `app/superadmin/login/page.js`
- `app/superadmin/dashboard/page.js`
- `app/superadmin/companies/page.js`
- `app/superadmin/companies/new/page.js`
- `app/superadmin/companies/[id]/page.js`
- `app/superadmin/analytics/page.js`
- `app/superadmin/reminders/page.js`
- `app/superadmin/email/page.js`

### Superadmin APIs

- `app/api/superadmin/auth/login/route.js`
- `app/api/superadmin/auth/session/route.js`
- `app/api/superadmin/companies/route.js`
- `app/api/superadmin/companies/[id]/route.js`
- `app/api/superadmin/companies/[id]/admin/route.js`
- `app/api/superadmin/companies/[id]/regenerate-setup-code/route.js`
- `app/api/superadmin/companies/[id]/notes/route.js`
- `app/api/superadmin/companies/[id]/reminders/route.js`
- `app/api/superadmin/stats/route.js`
- `app/api/superadmin/analytics/route.js`
- `app/api/superadmin/reminders/route.js`
- `app/api/superadmin/email/route.js`

### Setup and tenant onboarding

- `app/setup/[code]/page.js`
- `app/api/setup/tenant/route.js`
- `app/api/employees/route.js`
- `app/api/employees/bulk-import/route.js`
- `app/api/auth/login/route.js`

### Core libraries and models

- `lib/superadminAuth.js`
- `lib/superadminDb.js`
- `lib/tenantContext.js`
- `lib/tenantModels.js`
- `lib/auth.js`
- `models/SuperAdmin.js`
- `models/TenantCompany.js`
- `models/UserTenantMapping.js`

### Bootstrap script

- `scripts/seed-superadmin.js`

## 16. Bootstrap Command

To create or reset the root superadmin account, use:

```bash
SUPERADMIN_PASSWORD='your-password' node scripts/seed-superadmin.js
```

Important notes:

- `SUPERADMIN_PASSWORD` is required.
- `SUPERADMIN_EMAIL` defaults to `avi2001raj@gmail.com` unless overridden.
- `SUPERADMIN_NAME` defaults to `Aviraj Sharma` unless overridden.

This script writes to the `talio_superadmin` database.