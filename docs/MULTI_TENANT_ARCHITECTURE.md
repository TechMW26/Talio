# Talio Multi-Tenant Architecture - AI Context Document

## Overview

Talio is a multi-tenant HRMS (Human Resource Management System) built with Next.js 15 (App Router), MongoDB/Mongoose, and Socket.IO. Each company (tenant) has its own **isolated database** within the same MongoDB cluster, ensuring complete data separation and security.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         MongoDB Cluster                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │  talio_superadmin   │    │  talio_company_{slug}           │ │
│  │  (Central Registry) │    │  (Tenant Databases)             │ │
│  ├─────────────────────┤    ├─────────────────────────────────┤ │
│  │ - TenantCompany     │    │ - User                          │ │
│  │ - UserTenantMapping │    │ - Employee                      │ │
│  │ - SuperAdmin        │    │ - Department                    │ │
│  └─────────────────────┘    │ - Attendance                    │ │
│                              │ - Project, Task, etc.           │ │
│                              │ - (40+ models per tenant)       │ │
│                              └─────────────────────────────────┘ │
│                                                                   │
│  talio_company_acme     talio_company_globex    talio_company_xyz│
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Structure

### 1. SuperAdmin Database (`talio_superadmin`)

Central registry database that stores:

| Collection | Purpose |
|------------|---------|
| `TenantCompany` | Company records (name, slug, subscription, setup codes) |
| `UserTenantMapping` | Maps user emails → tenant database |
| `SuperAdmin` | Platform administrators (separate from company admins) |

### 2. Tenant Databases (`talio_company_{slug}`)

Each company gets an isolated database with 40+ collections:

**Core Models:**
- `User` - Authentication, roles, preferences
- `Employee` - Employee profiles, contact info
- `Department` - Organizational structure
- `Designation` - Job titles and levels
- `Company` - Company settings
- `CompanySettings` - System configuration

**Attendance & Time:**
- `Attendance` - Daily attendance records
- `AttendanceCorrection` - Correction requests
- `Leave`, `LeaveType`, `LeaveBalance` - Leave management
- `Holiday` - Company holidays
- `GeofenceLocation`, `GeofenceLog` - Location tracking
- `OvertimeRequest` - Overtime approvals

**Projects & Tasks:**
- `Project` - Project management
- `Task`, `TaskAssignee` - Task tracking
- `ProjectMember` - Team assignments
- `ProjectNote`, `ProjectTimelineEvent` - Activity tracking
- `ProjectApprovalRequest`, `ProjectCompletionApproval` - Approvals

**Communication:**
- `Chat` - Messages with embedded messages
- `Announcement` - Company announcements
- `Notification` - User notifications
- `Meeting` - Meeting scheduling with transcripts

**HR & Admin:**
- `Expense`, `Payroll` - Financial
- `Document`, `Asset` - Resources
- `Helpdesk` - Support tickets
- `Performance`, `PerformanceGoal`, `DailyGoal` - Reviews
- `Recruitment` - Hiring
- `Policy` - Company policies
- `Suggestion` - Ideas/feedback

**Productivity:**
- `Activity` - Screenshots/activity logs
- `ProductivitySession` - Work sessions
- `ScreenshotAnalysis` - AI analysis results
- `Whiteboard` - Collaborative boards

**System:**
- `UserSession` - Active sessions
- `PushSubscription` - Web push
- `PasswordResetToken` - Password resets
- `ScheduledNotification`, `RecurringNotification` - Scheduled alerts
- `CallAlert` - Instant alerts
- `SystemPreferences` - Tenant settings
- `EmailAccount` - Email integrations

---

## Key Files & Their Purposes

### Core Tenant System

| File | Purpose |
|------|---------|
| `lib/tenantDb.js` | Connection pool manager for tenant databases |
| `lib/tenantModels.js` | Schema registry (40+ schemas) and model factory |
| `lib/tenantContext.js` | Tenant lookup utilities (by email, slug, userId) |
| `lib/superadminDb.js` | SuperAdmin database connection |
| `lib/auth.js` | JWT verification + tenant-aware auth helpers |

### Data Models (for reference only)

| File | Note |
|------|------|
| `models/TenantCompany.js` | Company schema (superadmin DB only) |
| `models/UserTenantMapping.js` | Email→tenant mapping (superadmin DB only) |
| `models/*.js` | **DEPRECATED for authenticated routes** - Use `auth.models.X` instead |

---

## Authentication Flow

### Login Flow

```
1. User submits email + password
   │
2. Look up tenant from email
   │  └─ getTenantByEmail(email) → { databaseName, companySlug, ... }
   │
3. Connect to tenant database
   │  └─ getTenantConnection(databaseName)
   │
4. Verify credentials in tenant DB
   │  └─ UserModel.findOne({ email }).select('+password')
   │
5. Generate JWT with tenant info
   │  └─ { userId, email, role, employeeId, databaseName, companySlug, companyName }
   │
6. Register/update UserTenantMapping
   │
7. Return token to client
```

### JWT Payload Structure

```javascript
{
  userId: "65f2a1b3c4d5e6f7a8b9c0d1",      // User._id in tenant DB
  email: "john@acme.com",
  role: "admin" | "hr" | "manager" | "employee" | "department_head",
  employeeId: "65f2a1b3c4d5e6f7a8b9c0d2", // Employee._id
  databaseName: "talio_company_acme",      // CRITICAL: Tenant database
  companySlug: "acme",
  companyName: "ACME Corporation",
  exp: 1234567890                          // Expiration
}
```

---

## API Route Pattern

### ✅ CORRECT: Using `getAuthAndModels`

```javascript
// app/api/employees/route.js
import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export async function GET(request) {
  // Get auth + tenant-aware models in ONE call
  const auth = await getAuthAndModels(request, ['Employee', 'Department'])
  
  if (!auth.success) {
    return NextResponse.json({ message: auth.message }, { status: 401 })
  }
  
  const { user, models } = auth
  
  // models.Employee is bound to user's tenant database
  const employees = await models.Employee.find({ status: 'active' })
    .populate('department', 'name')
    .lean()
  
  return NextResponse.json(employees)
}

export async function POST(request) {
  const auth = await getAuthAndModels(request, ['Employee', 'Department', 'User'])
  
  if (!auth.success) {
    return NextResponse.json({ message: auth.message }, { status: 401 })
  }
  
  const { user, models, tenant } = auth
  const body = await request.json()
  
  // Create employee in tenant database
  const employee = await models.Employee.create({
    ...body,
    company: user.company || tenant.companyId,
  })
  
  // Emit real-time event
  if (global.io) {
    global.io.to(`user:${user._id || user.userId}`).emit('employee-created', {
      employee,
    })
  }
  
  return NextResponse.json(employee, { status: 201 })
}
```

### ❌ WRONG: Never Do This

```javascript
// DON'T use static model imports in authenticated routes
import Employee from '@/models/Employee'  // ❌ WRONG - uses default DB

// DON'T use connectDB() in authenticated routes
import connectDB from '@/lib/mongodb'      // ❌ WRONG - no tenant isolation
await connectDB()

// DON'T use verifyToken directly for data access
const decoded = await verifyToken(token)
const employee = await Employee.findById(decoded.employeeId)  // ❌ WRONG DB
```

---

## `getAuthAndModels` API Reference

### Function Signature

```javascript
async function getAuthAndModels(request, modelNames = [])
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `request` | `Request` | Next.js request object |
| `modelNames` | `string[]` | Array of model names to load |

### Return Value

```javascript
// Success
{
  success: true,
  user: {
    _id: ObjectId,
    id: ObjectId,           // Same as _id
    email: string,
    role: string,
    employeeId: ObjectId,
    userId: string,         // From JWT (use _id || userId for compatibility)
    databaseName: string,
    companySlug: string,
    companyName: string,
    token: string,          // Raw JWT for downstream API calls
  },
  tenant: {
    databaseName: string,
    companySlug: string,
    companyName: string,
  },
  models: {
    [modelName]: mongoose.Model,  // Tenant-bound models
  }
}

// Failure
{
  success: false,
  message: string,  // "No authentication token provided", "Invalid session", etc.
}
```

### Available Models (40+)

```javascript
// Core
'User', 'Employee', 'Department', 'Designation', 'Company', 'CompanySettings'

// Attendance
'Attendance', 'AttendanceCorrection', 'Leave', 'LeaveType', 'LeaveBalance',
'Holiday', 'GeofenceLocation', 'GeofenceLog', 'OvertimeRequest'

// Projects
'Project', 'Task', 'TaskAssignee', 'ProjectMember', 'ProjectNote',
'ProjectTimelineEvent', 'ProjectApprovalRequest', 'ProjectCompletionApproval'

// Communication
'Chat', 'Announcement', 'Notification', 'Meeting'

// HR
'Expense', 'Payroll', 'Document', 'Asset', 'Helpdesk', 'Performance',
'PerformanceGoal', 'DailyGoal', 'Recruitment', 'Policy', 'Suggestion'

// Productivity
'Activity', 'ProductivitySession', 'ScreenshotAnalysis', 'Whiteboard'

// System
'UserSession', 'PushSubscription', 'PasswordResetToken', 'CallAlert',
'ScheduledNotification', 'RecurringNotification', 'SystemPreferences',
'EmailAccount', 'HealthScore', 'ApprovalRequest', 'OnboardingEmail'

// Aliases
'Ticket' → 'Helpdesk'
'Idea' → 'Suggestion'
'Screenshot' → 'Activity'
```

### Model Dependencies (Auto-Loaded)

When you request a model, its dependencies are automatically loaded for `populate()`:

```javascript
// Requesting just 'Employee' will also load:
await getAuthAndModels(request, ['Employee'])
// Actually loads: Department, Designation, Company, Employee

// Requesting 'Task' will also load:
await getAuthAndModels(request, ['Task'])
// Actually loads: Employee, Project, Task
```

---

## User ID Handling

### CRITICAL: Always Use Fallback Pattern

```javascript
const userId = user._id || user.userId  // ✅ Correct

// NOT just user.userId (may be undefined)
// NOT just user._id (may be undefined in some contexts)
```

### Where IDs Come From

| Property | Source | When Available |
|----------|--------|----------------|
| `user._id` | Fresh DB query in `verifyTokenFromRequest` | Always (from User.findById) |
| `user.userId` | JWT payload | Always (from token) |
| `user.employeeId` | JWT + User.populate('employeeId') | Always for employees |
| `user.id` | Alias for `user._id` | Always |

---

## Role-Based Access Control (RBAC)

### Role Hierarchy

```
admin > department_head > hr > manager > employee
```

### Role Checking

```javascript
import { hasRole } from '@/lib/auth'

// Single role
if (!hasRole(user, ['admin'])) {
  return NextResponse.json({ message: 'Admin only' }, { status: 403 })
}

// Multiple roles
if (!hasRole(user, ['admin', 'hr', 'department_head'])) {
  return NextResponse.json({ message: 'Insufficient permissions' }, { status: 403 })
}
```

### Role Definitions

| Role | Description | Typical Access |
|------|-------------|----------------|
| `admin` | Company administrator | Full access |
| `department_head` | Department leader | Department + subordinates |
| `hr` | Human resources | All employees, leave, payroll |
| `manager` | Team manager | Team members |
| `employee` | Regular employee | Own data only |

---

## Socket.IO Integration

### Server-Side (API Routes)

```javascript
// Always check if global.io exists
if (global.io) {
  // Emit to specific user
  global.io.to(`user:${user._id || user.userId}`).emit('event-name', data)
  
  // Emit to project room
  global.io.to(`project:${projectId}`).emit('task-updated', task)
  
  // Emit to chat room
  global.io.to(`chat:${chatId}`).emit('new-message', message)
}
```

### Client-Side (React Components)

```javascript
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'

function MyComponent() {
  const { socket, isConnected, onAttendanceUpdate, subscribe } = useSocket()
  
  useEffect(() => {
    // Using built-in handlers
    const unsubscribe = onAttendanceUpdate((data) => {
      console.log('Attendance updated:', data)
    })
    
    return unsubscribe
  }, [onAttendanceUpdate])
  
  useEffect(() => {
    // Generic subscription
    const unsubscribe = subscribe('custom-event', (data) => {
      console.log('Custom event:', data)
    })
    
    return unsubscribe
  }, [subscribe])
}
```

### Socket Authentication

Socket.IO uses `User._id` (NOT `employeeId`):

```javascript
// Client: SocketContext.js
socket.emit('authenticate', userId)  // userId = User._id

// Server: server.js
socket.on('authenticate', (userId) => {
  socket.userId = userId
  socket.join(`user:${userId}`)
})
```

---

## Tenant Lookup Functions

### `getTenantByEmail(email)`

```javascript
import { getTenantByEmail } from '@/lib/tenantContext'

const tenant = await getTenantByEmail('john@acme.com')
// Returns:
{
  databaseName: 'talio_company_acme',
  companyName: 'ACME Corporation',
  companySlug: 'acme',
  tenantCompanyId: ObjectId,
  role: 'admin'
}
// Or null if not found
```

### `getTenantBySlug(slug)`

```javascript
import { getTenantBySlug } from '@/lib/tenantContext'

const company = await getTenantBySlug('acme')
// Returns:
{
  id: ObjectId,
  name: 'ACME Corporation',
  slug: 'acme',
  databaseName: 'talio_company_acme',
  serviceStatus: 'active',
  isSetupComplete: true,
  subscription: { ... }
}
```

### `getTenantByUserId(userId)`

```javascript
import { getTenantByUserId } from '@/lib/tenantContext'

const tenant = await getTenantByUserId('65f2a1b3c4d5e6f7a8b9c0d1')
// Same return as getTenantByEmail
```

---

## New Company Onboarding

### 1. SuperAdmin Creates Company

```javascript
// In superadmin panel
const TenantCompany = await getTenantCompanyModel()
const company = new TenantCompany({
  name: 'ACME Corporation',
  slug: 'acme',  // → databaseName: talio_company_acme
  primaryContact: {
    name: 'John Doe',
    email: 'john@acme.com',
    phone: '+1234567890'
  },
  subscription: {
    plan: 'professional',
    maxUsers: 50,
    tenureDays: 365
  }
})

// Generate setup code
const setupCode = company.generateSetupCode(7)  // Expires in 7 days
await company.save()

// Send setup link: https://app.talio.in/setup?code={setupCode}
```

### 2. Company Admin Completes Setup

```javascript
// POST /api/setup/tenant
const { setupCode, adminEmail, adminPassword, adminName } = body

// Validate setup code
const result = await validateSetupCode(setupCode)
if (!result.valid) {
  return error(result.reason)
}

// Create admin user in tenant DB
const connection = await getTenantConnection(result.company.databaseName)
const User = connection.model('User', UserSchema)
const Employee = connection.model('Employee', EmployeeSchema)

const employee = await Employee.create({ ... })
const user = await User.create({
  email: adminEmail,
  password: adminPassword,
  role: 'admin',
  employeeId: employee._id
})

// Register in mapping
await registerUserTenantMapping({
  email: adminEmail,
  tenantCompanyId: result.company.id,
  databaseName: result.company.databaseName,
  companyName: result.company.name,
  companySlug: result.company.slug,
  role: 'admin'
})

// Mark setup code as used
await markSetupCodeUsed(result.company.id, adminEmail)
```

---

## Common Patterns

### Department Head Access

```javascript
const auth = await getAuthAndModels(request, ['Employee', 'Department', 'User'])
const { user, models } = auth

// Check if user is department head
const userRecord = await models.User.findById(user._id || user.userId)
  .populate('headOfDepartments')
  .lean()

if (user.role === 'department_head' && userRecord.isDepartmentHead) {
  // Get employees in their departments
  const employees = await models.Employee.find({
    department: { $in: userRecord.headOfDepartments.map(d => d._id) }
  })
}
```

### Attendance with Work Hours Calculation

```javascript
const { models } = auth

// Status is ALWAYS calculated from work hours when checkIn/Out exist
// workHours >= 7.2h (90% of 8h) → present
// workHours >= 4h (50% of 8h) → half-day
// workHours < 4h → absent

const attendance = await models.Attendance.findOneAndUpdate(
  { employee: employeeId, date: dateStart },
  {
    checkIn: new Date(),
    checkOut: new Date(),
    workHours: calculatedHours,
    status: calculatedHours >= 7.2 ? 'present' : calculatedHours >= 4 ? 'half-day' : 'absent'
  },
  { upsert: true, new: true }
)
```

### Project with Team Access

```javascript
const { models, user } = auth

// Check project access
const project = await models.Project.findById(projectId)
  .populate('projectHeads', 'firstName lastName')
  .lean()

const member = await models.ProjectMember.findOne({
  project: projectId,
  user: user.employeeId,
  invitationStatus: 'accepted'
})

const isProjectHead = project.projectHeads.some(
  h => h._id.toString() === user.employeeId?.toString()
)

const canEdit = isProjectHead || ['admin', 'hr'].includes(user.role)
```

---

## Error Handling

### Standard API Response Pattern

```javascript
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Model'])
    
    if (!auth.success) {
      return NextResponse.json(
        { message: auth.message },
        { status: 401 }
      )
    }
    
    // ... business logic ...
    
    return NextResponse.json(data)
    
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json(
      { message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### Common Error Messages

| Status | Message | Cause |
|--------|---------|-------|
| 401 | "No authentication token provided" | Missing JWT |
| 401 | "Invalid or expired token" | Bad/expired JWT |
| 401 | "Invalid session - please log in again" | Missing databaseName in JWT |
| 401 | "User not found" | User deleted or wrong DB |
| 401 | "User account is deactivated" | user.isActive = false |
| 403 | "Insufficient permissions" | Wrong role |
| 500 | "Failed to load database models" | Connection error |

---

## Testing & Debugging

### Check Active Tenant Connections

```javascript
import { getActiveTenantConnections } from '@/lib/tenantDb'

const connections = getActiveTenantConnections()
// [{ databaseName: 'talio_company_acme', readyState: 1, readyStateString: 'connected' }]
```

### Clear Model Cache

```javascript
import { clearModelCache } from '@/lib/tenantModels'

clearModelCache('talio_company_acme')  // Specific tenant
clearModelCache()                       // All tenants
```

### Verify Tenant Mapping

```bash
# Check if user exists in mapping
mongosh "mongodb+srv://..." --eval "
  use talio_superadmin
  db.usertenantmappings.findOne({ email: 'john@acme.com' })
"
```

---

## Migration Notes

### From Single-Tenant to Multi-Tenant

1. **API Routes**: Replace `verifyToken` + static models with `getAuthAndModels`
2. **User ID**: Use `user._id || user.userId` pattern everywhere
3. **Model Imports**: Remove static model imports in authenticated routes
4. **connectDB**: Replace with `getAuthAndModels` (it handles connection)

### Changed Patterns

```javascript
// BEFORE (single-tenant)
import { verifyToken } from '@/lib/auth'
import Employee from '@/models/Employee'
import connectDB from '@/lib/mongodb'

await connectDB()
const decoded = await verifyToken(token)
const employee = await Employee.findById(decoded.employeeId)

// AFTER (multi-tenant)
import { getAuthAndModels } from '@/lib/auth'

const { user, models } = await getAuthAndModels(request, ['Employee'])
const employee = await models.Employee.findById(user.employeeId)
```

---

## Performance Considerations

### Connection Pooling

- Each tenant database has its own connection pool (10 max, 2 min)
- Connections are cached in `tenantConnections` Map
- Models are cached per connection in `modelCache` Map

### Dependencies Auto-Loading

Models load their dependencies automatically:
- `Employee` → loads `Department`, `Designation`, `Company`
- `Task` → loads `Employee`, `Project`

This ensures `populate()` always works but increases initial load.

### Caching

- Tenant lookups cached for 5 minutes (`tenantCache`)
- Clear cache after admin updates: `clearTenantCache(email)`

---

## Security Checklist

- [ ] Never use `connectDB()` in authenticated routes
- [ ] Never import static models from `/models/` in authenticated routes
- [ ] Always check `auth.success` before accessing data
- [ ] Always use `user._id || user.userId` for user identification
- [ ] Always verify role with `hasRole()` for sensitive operations
- [ ] Always check `global.io` before emitting socket events
- [ ] Never store plain passwords (bcrypt is auto-applied)
- [ ] JWT includes `databaseName` - reject tokens without it

---

## Quick Reference

```javascript
// Standard API route template
import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Model1', 'Model2'])
    
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    
    const { user, models, tenant } = auth
    
    // Optional: Role check
    if (!hasRole(user, ['admin', 'hr'])) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }
    
    const body = await request.json()
    
    // Business logic using models.Model1, models.Model2
    const result = await models.Model1.create({ ...body })
    
    // Real-time notification
    if (global.io) {
      global.io.to(`user:${user._id || user.userId}`).emit('event', result)
    }
    
    return NextResponse.json(result, { status: 201 })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
```

---

*Last Updated: December 27, 2025*
*Version: 2.0 (Multi-Tenant Architecture)*
