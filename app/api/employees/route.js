import { NextResponse } from 'next/server'
import queryCache from '@/lib/queryCache'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'
import bcrypt from 'bcryptjs'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import { syncUserToBackup } from '@/lib/backupDb'
import { emitEmployeeUpdate, emitDashboardRefresh } from '@/lib/realtimeEvents'
import { getAuthAndModels } from '@/lib/auth'
import { checkUserLimit, registerUserTenantMapping, getTenantCompanyByDbName } from '@/lib/tenantContext'
import { generateAndStoreKRIsKPIs } from '@/lib/kriGenerator'
import mongoose from 'mongoose'
import {
  inferLevelFromTitle,
  levelNameFromNumber,
  canHaveAssignedManager,
  canHaveAssignedTeamLead,
  requiresReportsTo,
  REPORTS_TO_CANDIDATE_LEVELS,
  allowedReportsToLevels,
  DIRECTOR_LEVEL,
} from '@/lib/designationLevels'

export const dynamic = 'force-dynamic'

function makeDesignationCode(title) {
  return (title || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'DESIG'
}

async function resolveDesignationRef(Designation, payload) {
  const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v)
  if (payload.designation && isObjectId(String(payload.designation))) {
    const existing = await Designation.findById(payload.designation).select('_id level levelName').lean()
    if (existing) {
      payload.designationLevel = Number(payload.designationLevel || existing.level || inferLevelFromTitle(payload.designationLevelName || ''))
      payload.designationLevelName = payload.designationLevelName || existing.levelName || levelNameFromNumber(payload.designationLevel)
      return payload.designation
    }
  }

  const title = (payload.designationTitle || payload.designationLevelName || '').toString().trim()
  if (!title) return payload.designation

  let designation = await Designation.findOne({ title: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean()
  if (!designation) {
    const level = Number(payload.designationLevel) || inferLevelFromTitle(title)
    const levelName = payload.designationLevelName || levelNameFromNumber(level)
    const baseCode = makeDesignationCode(title)
    let code = baseCode
    let suffix = 2
    while (await Designation.exists({ code })) {
      code = `${baseCode}-${suffix++}`
    }
    designation = await Designation.create({
      title,
      code,
      level,
      levelName,
      isActive: true,
    })
    designation = designation.toObject()
  }

  payload.designation = designation._id
  payload.designationLevel = Number(payload.designationLevel || designation.level || inferLevelFromTitle(title))
  payload.designationLevelName = payload.designationLevelName || designation.levelName || levelNameFromNumber(payload.designationLevel)
  return designation._id
}

function validateHierarchyAssignmentPayload(payload, level, selfEmployeeId) {
  const assignedManager = payload.assignedManager ? String(payload.assignedManager) : ''
  const assignedTeamLead = payload.assignedTeamLead ? String(payload.assignedTeamLead) : ''
  const reportsTo = payload.reportsTo ? String(payload.reportsTo) : ''
  const lvl = Number(level) || 0

  if (selfEmployeeId) {
    if (assignedManager && assignedManager === String(selfEmployeeId)) return 'Employee cannot be assigned as their own manager'
    if (assignedTeamLead && assignedTeamLead === String(selfEmployeeId)) return 'Employee cannot be assigned as their own team lead'
    if (reportsTo && reportsTo === String(selfEmployeeId)) return 'Employee cannot report to themselves'
  }

  if (!canHaveAssignedManager(lvl) && assignedManager) {
    return 'Director role cannot have an assigned manager'
  }
  if (!canHaveAssignedTeamLead(lvl) && assignedTeamLead) {
    return 'Only IC roles (Senior and below) can have an assigned team lead'
  }

  if (lvl === DIRECTOR_LEVEL && reportsTo) {
    return 'Director role does not report to anyone'
  }

  if (assignedManager && assignedTeamLead && assignedManager === assignedTeamLead) {
    return 'Assigned manager and assigned team lead must be different users'
  }

  return null
}
// GET - List all employees with filters
export async function GET(request) {
  try {
    // Get auth and tenant-aware models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Designation']);

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

    const { models: { Employee: TenantEmployee, User: TenantUser, Department: TenantDepartment, Designation: TenantDesignation } } = auth;

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 10
    const search = searchParams.get('search') || ''
    const department = searchParams.get('department')
    const departmentsParam = searchParams.get('departments') // Comma-separated list of department IDs
    const designation = searchParams.get('designation')
    const level = searchParams.get('level')
    const status = searchParams.get('status')
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    // Redis-backed cache key (tenant-isolated)
    const redisCacheKey = buildCacheKey({
      tenantId: auth.tenant?.databaseName,
      role: auth.user?.role || 'any',
      userId: 'all',
      namespace: 'employees:list',
      params: { page, limit, search, department, departmentsParam, designation, level, status, sortBy, sortOrder },
    })
    const redisCached = await getCache(redisCacheKey)
    if (redisCached) {
      return NextResponse.json(redisCached)
    }

    // Fallback: in-memory queryCache
    const cacheKey = queryCache.generateKey('employees', page, limit, search, department, departmentsParam, designation, level, status, sortBy, sortOrder)
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build query
    const query = {}

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ]
    }

    // Handle multiple departments filter (comma-separated)
    if (departmentsParam) {
      const deptIds = departmentsParam.split(',').filter(id => id.trim())
      if (deptIds.length > 0) {
        query.department = { $in: deptIds }
      }
    } else if (department) {
      query.department = department
    }

    if (designation) {
      query.designation = designation
    }

    if (level) {
      query.designationLevel = parseInt(level)
    }

    if (status) {
      query.status = status
    }

    const skip = (page - 1) * limit

    // Build sort object
    const sortObj = {}
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1

    // Optimized: Use select() to fetch only needed fields and lean() for plain objects
    // Include salary and statutory fields for payroll calculations
    const employees = await TenantEmployee.find(query)
      .select('employeeCode firstName lastName email phone department departments designation designationLevel designationLevelName reportingManager assignedManager assignedTeamLead dateOfJoining status profilePicture salary pfEnrollment esiEnrollment professionalTax healthInsurance basicSalary')
      .populate({
        path: 'department',
        select: 'name _id',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'departments',
        select: 'name code _id',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'designation',
        select: 'title levelName level',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'reportingManager',
        select: 'firstName lastName',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'assignedManager',
        select: 'firstName lastName employeeCode designation designationLevel designationLevelName',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'assignedTeamLead',
        select: 'firstName lastName employeeCode designation designationLevel designationLevelName',
        options: { strictPopulate: false, lean: true }
      })
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean()

    // Optimized: Single query to get all user data
    const employeeIds = employees.map(emp => emp._id)
    const users = await TenantUser.find({ employeeId: { $in: employeeIds } })
      .select('_id email role employeeId')
      .lean()

    // Create a map of employeeId to user data
    const userMap = {}
    users.forEach(user => {
      if (user.employeeId) {
        userMap[user.employeeId.toString()] = {
          _id: user._id,
          email: user.email,
          role: user.role
        }
      }
    })

    // Add user data to employees
    const employeesWithUsers = employees.map(emp => ({
      ...emp,
      userId: userMap[emp._id.toString()] || null
    }))

    const total = await TenantEmployee.countDocuments(query)

    const response = {
      success: true,
      data: employeesWithUsers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    }

    // Store in Redis cache (30s TTL, tenant-isolated) AND in-memory fallback
    await setCache(redisCacheKey, response, 30)
    queryCache.set(cacheKey, response, 30000)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get employees error:', error)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch employees', error: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new employee
export async function POST(request) {
  try {
    // Get auth and tenant-aware models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Designation', 'OnboardingEmail', 'CompanySettings', 'Role']);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message || 'Unauthorized' },
        { status: 401 }
      )
    }

    const { models: { Employee: TenantEmployee, User: TenantUser, OnboardingEmail: TenantOnboardingEmail, CompanySettings: TenantCompanySettings, Role: TenantRole } } = auth;

    // Check user limit for tenant if tenant info is available
    if (auth.tenant?.databaseName) {
      const limitCheck = await checkUserLimit(auth.tenant.databaseName)
      if (!limitCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            message: limitCheck.message || 'User limit reached',
            userLimitExceeded: true,
            currentCount: limitCheck.currentCount,
            maxUsers: limitCheck.maxUsers
          },
          { status: 403 }
        )
      }
    }

    const data = await request.json()

    // Optimized: Check both in parallel
    const [existingEmployee, existingEmail, existingUser] = await Promise.all([
      TenantEmployee.findOne({ employeeCode: data.employeeCode }).lean(),
      TenantEmployee.findOne({ email: data.email }).lean(),
      TenantUser.findOne({ email: data.email }).lean()
    ])

    if (existingEmployee) {
      return NextResponse.json(
        { success: false, message: 'Employee code already exists' },
        { status: 400 }
      )
    }

    if (existingEmail) {
      return NextResponse.json(
        { success: false, message: 'Email already exists' },
        { status: 400 }
      )
    }

    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'User account with this email already exists' },
        { status: 400 }
      )
    }

    // Prepare employee data - ensure company is properly set
    const employeeData = { ...data }

    // Sanitize ObjectId fields - convert empty strings to null/undefined
    const objectIdFields = ['company', 'department', 'designation', 'reportingManager', 'assignedManager', 'assignedTeamLead'];
    objectIdFields.forEach(field => {
      if (employeeData[field] === '') {
        employeeData[field] = undefined; // Remove from object so Mongoose doesn't try to cast it
      }
    });

    // Resolve custom designation titles (CTO/CMO/CEO/etc) into actual Designation docs.
    await resolveDesignationRef(auth.models.Designation, employeeData)

    // Handle multiple departments
    if (employeeData.departments && Array.isArray(employeeData.departments) && employeeData.departments.length > 0) {
      // Filter out empty strings
      employeeData.departments = employeeData.departments.filter(d => d && d !== '')
      // Set primary department as the first one if not explicitly set
      if (!employeeData.department || employeeData.department === '') {
        employeeData.department = employeeData.departments[0]
      }
    } else if (employeeData.department && employeeData.department !== '') {
      // If only single department is provided, also add it to departments array
      employeeData.departments = [employeeData.department]
    }

    // Handle designation level
    if (employeeData.designationLevel) {
      employeeData.designationLevel = parseInt(employeeData.designationLevel) || 1
    }

    const effectiveLevel = Number(employeeData.designationLevel) || inferLevelFromTitle(employeeData.designationLevelName || '')
    const assignmentValidationError = validateHierarchyAssignmentPayload(employeeData, effectiveLevel)
    if (assignmentValidationError) {
      return NextResponse.json(
        { success: false, message: assignmentValidationError },
        { status: 400 }
      )
    }

    // Validate the reportsTo target's level against the strict hierarchy:
    //  L8 -> only L9 ; L7 -> L8 or L9 ; L1-L6 -> L7/L8/L9.
    if (employeeData.reportsTo) {
      const target = await TenantEmployee.findById(employeeData.reportsTo)
        .select('_id designationLevel designationLevelName designation')
        .lean()
      if (!target) {
        return NextResponse.json({ success: false, message: 'Selected "Reports To" employee not found' }, { status: 400 })
      }
      const targetLvl = Number(target.designationLevel) || inferLevelFromTitle(target.designationLevelName || '')
      const allowed = allowedReportsToLevels(effectiveLevel)
      if (!allowed.has(targetLvl)) {
        const allowedNames = Array.from(allowed).sort((a, b) => b - a).map((l) => ({ 9: 'Director', 8: 'Assistant Director', 7: 'C-Suite' }[l] || `L${l}`)).join(', ')
        return NextResponse.json({ success: false, message: `"Reports To" must be one of: ${allowedNames}` }, { status: 400 })
      }
    } else if (requiresReportsTo(effectiveLevel)) {
      // Soft requirement: warn-only when no candidate exists yet (e.g. brand-new orgs).
      const allowed = allowedReportsToLevels(effectiveLevel)
      const anyCandidate = await TenantEmployee.exists({ designationLevel: { $in: Array.from(allowed) } })
      if (anyCandidate) {
        const allowedNames = Array.from(allowed).sort((a, b) => b - a).map((l) => ({ 9: 'Director', 8: 'Assistant Director', 7: 'C-Suite' }[l] || `L${l}`)).join(', ')
        return NextResponse.json(
          { success: false, message: `"Reports To" is required (pick one of: ${allowedNames})` },
          { status: 400 }
        )
      }
    }

    // If no explicit reporting manager is provided, derive from hierarchy assignments.
    if (!employeeData.reportingManager) {
      if (employeeData.assignedTeamLead) employeeData.reportingManager = employeeData.assignedTeamLead
      else if (employeeData.assignedManager) employeeData.reportingManager = employeeData.assignedManager
      else if (employeeData.reportsTo) employeeData.reportingManager = employeeData.reportsTo
    }

    // Create employee first
    const employee = await TenantEmployee.create(employeeData)

    // Create user account for the employee
    const password = data.password || 'employee123' // Default password if not provided

    const userData = {
      email: data.email,
      password: password, // Let the pre-save hook handle hashing
      role: data.role || 'employee', // Default role is employee
      employeeId: employee._id,
      forcePasswordChange: true, // Force password change on first login
    }

    // Look up roleId from Role collection
    if (TenantRole) {
      const roleDoc = await TenantRole.findOne({ name: userData.role }).select('_id').lean()
      if (roleDoc) {
        userData.roleId = roleDoc._id
      }
    }

    // Add company to user if provided (same company as employee)
    if (data.company && data.company !== '') {
      userData.company = data.company
    }

    const user = await TenantUser.create(userData)

    // Update employee with userId reference
    await TenantEmployee.findByIdAndUpdate(employee._id, { userId: user._id })

    // Register user in tenant mapping if this is a multi-tenant setup
    if (auth.tenant?.databaseName) {
      const tenantCompany = await getTenantCompanyByDbName(auth.tenant.databaseName)
      if (tenantCompany) {
        registerUserTenantMapping({
          email: data.email,
          tenantCompanyId: tenantCompany._id,
          databaseName: auth.tenant.databaseName,
          companyName: tenantCompany.name,
          companySlug: tenantCompany.slug,
          role: data.role || 'employee',
        }).catch(err => console.error('[Employee Create] Tenant mapping failed:', err))
      }
    }

    // Sync user to backup database (fire-and-forget)
    // Get the hashed password from the created user for backup
    const userWithPassword = await TenantUser.findById(user._id).select('+password').lean()
    syncUserToBackup({
      userId: user._id,
      email: user.email,
      firstName: data.firstName,
      lastName: data.lastName,
      password: userWithPassword.password, // Hashed password
      role: user.role,
    }).catch(err => console.error('[Employee Create] Backup sync failed:', err))

    const populatedEmployee = await TenantEmployee.findById(employee._id)
      .select('employeeCode firstName lastName email phone department departments designation designationLevel designationLevelName reportingManager assignedManager assignedTeamLead dateOfJoining status salary pfEnrollment esiEnrollment professionalTax healthInsurance basicSalary')
      .populate({
        path: 'department',
        select: 'name',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'departments',
        select: 'name code',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'designation',
        select: 'title levelName level',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'reportingManager',
        select: 'firstName lastName',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'assignedManager',
        select: 'firstName lastName employeeCode',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'assignedTeamLead',
        select: 'firstName lastName employeeCode',
        options: { strictPopulate: false }
      })
      .lean()

    // Clear both Redis and in-memory employee list caches
    const bustPattern = buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employees:list' })
    await clearCachePattern(bustPattern).catch(() => { })
    queryCache.clearPattern('employees')

    // Send onboarding email and log to database (async, don't block response)
    const actualPassword = data.password || 'employee123'
    sendAndLogOnboardingEmail({
      employeeId: employee._id,
      userId: user._id,
      to: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: actualPassword,
      employeeCode: data.employeeCode,
      designation: populatedEmployee?.designation?.title || data.designationLevelName,
      department: populatedEmployee?.department?.name,
      dateOfJoining: data.dateOfJoining,
      triggeredBy: 'manual_creation',
      models: { OnboardingEmail: TenantOnboardingEmail, CompanySettings: TenantCompanySettings },
    }).catch(err => {
      console.error('[Employee Create] Failed to send onboarding email:', err)
    })

    // Emit real-time update for new employee
    emitEmployeeUpdate({
      action: 'created',
      employee: populatedEmployee,
      departmentId: data.department,
    })
    emitDashboardRefresh({ reason: 'employee-created' })

    // Auto-generate AI KRIs + starter KPIs in the background based on designation/department.
    generateAndStoreKRIsKPIs({
      Employee: TenantEmployee,
      employeeId: employee._id,
      userId: auth.user?._id || auth.user?.userId,
      generateKPIs: true,
    }).catch((err) => console.error('[Employee Create] Auto KRI/KPI generation failed:', err.message))

    return NextResponse.json({
      success: true,
      message: 'Employee and user account created successfully',
      data: populatedEmployee,
      credentials: {
        email: data.email,
        password: data.password || 'employee123',
        message: 'Please share these credentials with the employee'
      }
    }, { status: 201 })
  } catch (error) {
    console.error('Create employee error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create employee' },
      { status: 500 }
    )
  }
}

