import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'
import { logActivity } from '@/lib/activityLogger'
import { deleteUserFromBackup } from '@/lib/backupDb'
import { emitEmployeeUpdate, emitDashboardRefresh, emitAssetUpdate } from '@/lib/realtimeEvents'
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

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

function makeDesignationCode(title) {
  return (title || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'DESIG'
}

async function resolveDesignationRef(Designation, payload) {
  if (!Designation) return payload.designation
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

// GET - Get single employee
export async function GET(request, { params }) {
  try {
    // Await params in Next.js 15
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Designation', 'Company'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User, Department, Designation, Company } = models

    if (!Employee || !User) {
      return NextResponse.json(
        { success: false, message: 'Employee models not initialized' },
        { status: 500 }
      )
    }

    // Check Redis cache first (2 min TTL), then fall back to in-memory queryCache
    const redisCacheKey = buildCacheKey({
      tenantId: auth.tenant?.databaseName,
      role: 'any',
      userId: 'all',
      namespace: 'employee:detail',
      params: { id },
    })
    const redisCached = await getCache(redisCacheKey)
    if (redisCached) {
      return NextResponse.json(redisCached)
    }

    // Fallback: in-memory queryCache
    const cacheKey = queryCache.generateKey(auth.tenant.databaseName, 'employee', id)
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    let employee = await Employee.findById(id)
      .populate({
        path: 'department',
        select: 'name',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'departments',
        select: 'name code',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'designation',
        select: 'title levelName level',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'reportingManager',
        select: 'firstName lastName email',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'assignedManager',
        select: 'firstName lastName email employeeCode designation designationLevel designationLevelName',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'assignedTeamLead',
        select: 'firstName lastName email employeeCode designation designationLevel designationLevelName',
        options: { strictPopulate: false, lean: true }
      })
      .populate({
        path: 'company',
        select: 'name timezone',
        options: { strictPopulate: false, lean: true }
      })
      .lean()

    // If not found by employee ID, check if it's a user ID and get employee from there
    if (!employee) {
      const userWithEmployee = await User.findById(id).select('employeeId').lean()
      if (userWithEmployee?.employeeId) {
        employee = await Employee.findById(userWithEmployee.employeeId)
          .populate({
            path: 'department',
            select: 'name',
            options: { strictPopulate: false, lean: true }
          })
          .populate({
            path: 'departments',
            select: 'name code',
            options: { strictPopulate: false, lean: true }
          })
          .populate({
            path: 'designation',
            select: 'title levelName level',
            options: { strictPopulate: false, lean: true }
          })
          .populate({
            path: 'reportingManager',
            select: 'firstName lastName email',
            options: { strictPopulate: false, lean: true }
          })
          .populate({
            path: 'assignedManager',
            select: 'firstName lastName email employeeCode designation designationLevel designationLevelName',
            options: { strictPopulate: false, lean: true }
          })
          .populate({
            path: 'assignedTeamLead',
            select: 'firstName lastName email employeeCode designation designationLevel designationLevelName',
            options: { strictPopulate: false, lean: true }
          })
          .lean()
      }
    }

    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Get user data for this employee (reverse lookup)
    const employeeUser = await User.findOne({ employeeId: employee._id })
      .select('_id email role')
      .lean()

    // Add user data to employee
    const employeeWithUser = {
      ...employee,
      userId: employeeUser || null
    }

    const response = {
      success: true,
      data: employeeWithUser,
    }

    // Write to both Redis (2 min TTL) and in-memory queryCache
    void setCache(redisCacheKey, response, 2 * 60).catch(() => { })
    queryCache.set(cacheKey, response, 60000)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get employee error:', error)
    console.error('Error stack:', error.stack)
    if (error?.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }
    if (error?.name === 'MongoNetworkError' || /buffering timed out/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, message: 'Database connection unavailable' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { success: false, message: 'Failed to fetch employee', error: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update employee
export async function PUT(request, { params }) {
  try {
    // Await params in Next.js 15
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Designation', 'Role'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User, Department, Designation, Role } = models

    if (!Employee || !User) {
      return NextResponse.json(
        { success: false, message: 'Employee models not initialized' },
        { status: 500 }
      )
    }

    const data = await request.json()

    // Check if employee exists
    const employee = await Employee.findById(id).lean()
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    const requestedSystemRole = typeof data.systemRole === 'string' ? data.systemRole.trim() : ''

    let linkedUser = null
    let targetRole = null
    if (requestedSystemRole) {
      linkedUser = await User.findOne({ employeeId: employee._id })
        .select('_id email role roleId permissionsCache cacheUpdatedAt employeeId')
        .lean()

      if (!linkedUser) {
        return NextResponse.json(
          { success: false, message: 'No linked user account found for this employee' },
          { status: 400 }
        )
      }

      targetRole = null
      if (Role) {
        if (employee.company) {
          targetRole = await Role.findOne({ name: requestedSystemRole, company: employee.company })
            .select('_id name displayLabel')
            .lean()
        }

        if (!targetRole) {
          targetRole = await Role.findOne({ name: requestedSystemRole })
            .select('_id name displayLabel')
            .lean()
        }
      }

      if (!targetRole) {
        return NextResponse.json(
          { success: false, message: 'Selected system role was not found' },
          { status: 400 }
        )
      }

      data.systemRole = requestedSystemRole
    }

    // Optimized: Check both validations in parallel if needed
    const validationChecks = []

    if (data.employeeCode && data.employeeCode !== employee.employeeCode) {
      validationChecks.push(
        Employee.findOne({ employeeCode: data.employeeCode }).lean()
          .then(existing => existing ? 'Employee code already exists' : null)
      )
    }

    if (data.email && data.email !== employee.email) {
      validationChecks.push(
        Employee.findOne({ email: data.email }).lean()
          .then(existing => existing ? 'Email already exists' : null)
      )
    }

    if (validationChecks.length > 0) {
      const errors = (await Promise.all(validationChecks)).filter(Boolean)
      if (errors.length > 0) {
        return NextResponse.json(
          { success: false, message: errors[0] },
          { status: 400 }
        )
      }
    }

    // Handle multiple departments
    console.log('Received departments:', data.departments)
    console.log('Received department (legacy):', data.department)

    // Sanitize ObjectId fields - convert empty strings to null/undefined
    const objectIdFields = ['company', 'department', 'designation', 'reportingManager', 'assignedManager', 'assignedTeamLead'];
    objectIdFields.forEach(field => {
      if (data[field] === '') {
        data[field] = undefined; // Remove from object so Mongoose doesn't try to cast it
      }
    });

    await resolveDesignationRef(Designation, data)

    if (data.departments && Array.isArray(data.departments) && data.departments.length > 0) {
      // Filter out empty strings
      data.departments = data.departments.filter(d => d && d !== '')
      console.log('After filtering departments:', data.departments)
      // Set primary department as the first one if not explicitly set
      if (!data.department || data.department === '') {
        data.department = data.departments[0]
      }
    } else if (data.department && data.department !== '') {
      // If only single department is provided, also add it to departments array
      data.departments = [data.department]
    }

    console.log('Final departments to save:', data.departments)
    console.log('Final department (primary) to save:', data.department)

    // Handle designation level
    if (data.designationLevel) {
      data.designationLevel = parseInt(data.designationLevel) || 1
    }

    const effectiveLevel = Number(data.designationLevel || employee.designationLevel || 0) || inferLevelFromTitle(data.designationLevelName || employee.designationLevelName || '')
    const assignmentValidationError = validateHierarchyAssignmentPayload(data, effectiveLevel, employee._id)
    if (assignmentValidationError) {
      return NextResponse.json(
        { success: false, message: assignmentValidationError },
        { status: 400 }
      )
    }

    // Validate the reportsTo target's level against the strict hierarchy:
    //  L8 -> only L9 ; L7 -> L8 or L9 ; L1-L6 -> L7/L8/L9.
    if (data.reportsTo) {
      const target = await Employee.findById(data.reportsTo)
        .select('_id designationLevel designationLevelName')
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
    }

    if (!data.reportingManager) {
      if (data.assignedTeamLead) data.reportingManager = data.assignedTeamLead
      else if (data.assignedManager) data.reportingManager = data.assignedManager
      else if (data.reportsTo) data.reportingManager = data.reportsTo
    }

    // System role belongs to the linked User document, not the Employee document.
    delete data.systemRole

    // Handle profile picture upload to GridFS if base64 is provided
    if (data.profilePicture && data.profilePicture.startsWith('data:image/')) {
      console.log('[Employee Update] Processing profile picture upload...')

      try {
        const { uploadImage, deleteImage } = await import('@/lib/gridfs')
        const { optimizeImage, isValidImage } = await import('@/lib/imageOptimization')

        // Extract base64 data
        const base64Data = data.profilePicture.replace(/^data:image\/\w+;base64,/, '')
        const imageBuffer = Buffer.from(base64Data, 'base64')

        // Validate image
        if (await isValidImage(imageBuffer)) {
          // Optimize image
          const { buffer: optimizedBuffer } = await optimizeImage(imageBuffer, {
            type: 'avatar',
            format: 'webp',
            quality: 85
          })

          // Generate filename
          const timestamp = Date.now()
          const employeeCode = employee.employeeCode || 'UNKNOWN'
          const filename = `profile_${employeeCode}_${timestamp}.webp`

          console.log('[Employee Update] Uploading to GridFS...')

          const gridfsResult = await uploadImage(optimizedBuffer, {
            category: 'profile',
            contentType: 'image/webp',
            originalName: filename,
            employeeId: String(id),
          })

          // Delete old profile picture from GridFS if exists
          if (employee.profilePictureFileId) {
            try {
              await deleteImage(employee.profilePictureFileId)
              console.log(`[Employee Update] Deleted old GridFS file: ${employee.profilePictureFileId}`)
            } catch (err) {
              console.log('[Employee Update] Old file cleanup:', err.message)
            }
          }

          // Update data with GridFS URL
          data.profilePicture = gridfsResult.url
          data.profilePictureFileId = String(gridfsResult._id)
          console.log(`[Employee Update] Profile picture uploaded to GridFS: ${gridfsResult.url}`)
        }
      } catch (uploadError) {
        console.error('[Employee Update] Profile picture upload failed:', uploadError.message)
      }
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(
      id,
      data,
      { new: true, runValidators: true }
    )
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

    let updatedLinkedUser = linkedUser
    if (requestedSystemRole && linkedUser && targetRole) {
      const currentRoleId = linkedUser.roleId?.toString?.() || linkedUser.roleId?.toString() || ''
      const targetRoleId = targetRole._id?.toString?.() || targetRole._id?.toString() || ''
      const shouldUpdateRole =
        linkedUser.role !== requestedSystemRole ||
        currentRoleId !== targetRoleId ||
        linkedUser.permissionsCache !== null ||
        linkedUser.cacheUpdatedAt !== null

      if (shouldUpdateRole) {
        const updateResult = await User.collection.updateOne(
          { _id: linkedUser._id },
          {
            $set: {
              role: requestedSystemRole,
              roleId: targetRole._id,
              permissionsCache: null,
              cacheUpdatedAt: null,
            },
          }
        )

        if (updateResult.matchedCount === 0) {
          return NextResponse.json(
            { success: false, message: 'Failed to locate linked user for role update' },
            { status: 500 }
          )
        }

        updatedLinkedUser = await User.findById(linkedUser._id)
          .select('_id email role roleId employeeId permissionsCache cacheUpdatedAt')
          .lean()

        const persistedRoleId = updatedLinkedUser?.roleId?.toString?.() || updatedLinkedUser?.roleId?.toString() || ''
        if (!updatedLinkedUser || updatedLinkedUser.role !== requestedSystemRole || persistedRoleId !== targetRoleId) {
          return NextResponse.json(
            { success: false, message: 'System role update did not persist correctly' },
            { status: 500 }
          )
        }

        console.log(`[Employee Update] Updated user role from ${linkedUser.role} to ${requestedSystemRole} (roleId: ${targetRole._id}) for employee ${id}`)
      }
    }

    // Clear cache for this employee and related user/auth state
    queryCache.delete(queryCache.generateKey(auth.tenant.databaseName, 'employee', id))
    queryCache.clearPattern('employees')
    const employeeUserId = updatedLinkedUser?._id?.toString() || linkedUser?._id?.toString() || '*'
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'employee:detail' })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employees:list' })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'auth:user', userId: employeeUserId })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'profile', userId: employeeUserId })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:employee-stats', userId: employeeUserId })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' })).catch(() => { })

    // Log activity for profile update
    await logActivity({
      employeeId: id,
      type: 'profile_update',
      action: 'Updated profile',
      details: 'Profile information updated',
      relatedModel: 'Employee',
      relatedId: id
    })

    // Emit real-time update for employee update
    emitEmployeeUpdate({
      action: 'updated',
      employee: updatedEmployee,
      employeeId: id,
    })
    emitDashboardRefresh({ reason: 'employee-updated' })

    // Auto-regenerate AI KRIs when role changes (promotion / department change).
    try {
      const designationChanged = data.designation && String(data.designation) !== String(employee.designation || '')
      const departmentChanged = data.department && String(data.department) !== String(employee.department || '')
      const levelChanged = data.designationLevel && Number(data.designationLevel) !== Number(employee.designationLevel || 0)
      if (designationChanged || departmentChanged || levelChanged) {
        const { generateAndStoreKRIsKPIs } = await import('@/lib/kriGenerator')
        generateAndStoreKRIsKPIs({
          Employee,
          employeeId: id,
          userId: auth.user?._id || auth.user?.userId,
          generateKPIs: false,
        }).catch((err) => console.error('[Employee Update] Auto KRI regeneration failed:', err.message))
      }
    } catch (e) {
      console.warn('[Employee Update] Could not schedule KRI regeneration:', e.message)
    }

    return NextResponse.json({
      success: true,
      message: 'Employee updated successfully',
      data: {
        ...updatedEmployee,
        userId: updatedLinkedUser || linkedUser || null,
      },
    })
  } catch (error) {
    console.error('Update employee error:', error)
    if (error?.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }
    if (error?.name === 'MongoNetworkError' || /buffering timed out/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, message: 'Database connection unavailable' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update employee' },
      { status: 500 }
    )
  }
}

// DELETE - Hard delete employee (removes from both Employee and User collections)
export async function DELETE(request, { params }) {
  try {
    // Await params in Next.js 15
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Asset'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User, Asset } = models

    if (!Employee || !User) {
      return NextResponse.json(
        { success: false, message: 'Employee models not initialized' },
        { status: 500 }
      )
    }

    const employee = await Employee.findById(id)
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Free all assets assigned to this employee
    if (Asset) {
      try {
        const freedAssets = await Asset.updateMany(
          { assignedTo: id },
          { $set: { status: 'available', returnDate: new Date() }, $unset: { assignedTo: 1, assignedDate: 1 } }
        )
        if (freedAssets.modifiedCount > 0) {
          console.log(`[Employee Delete] Freed ${freedAssets.modifiedCount} asset(s) for employee: ${id}`)
          emitAssetUpdate({ action: 'bulk-freed', employeeId: id, count: freedAssets.modifiedCount })
        }
      } catch (assetErr) {
        console.error('[Employee Delete] Failed to free assets:', assetErr)
      }
    }

    // Find the associated user BEFORE deletion (needed for cache clearing)
    const user = await User.findOne({ employeeId: id })
    const deletedUserId = user?._id?.toString() || '*'

    if (user) {
      // Delete user from backup database (fire-and-forget)
      deleteUserFromBackup(user._id).catch(err =>
        console.error('[Employee Delete] Backup delete failed:', err)
      )

      // Hard delete the user from main database
      await User.findByIdAndDelete(user._id)
      console.log(`[Employee Delete] Deleted user: ${user._id} (${user.email})`)
    }

    // Delete profile picture from GridFS if exists
    if (employee.profilePictureFileId) {
      try {
        const { deleteImage } = await import('@/lib/gridfs')
        await deleteImage(employee.profilePictureFileId)
        console.log(`[Employee Delete] Deleted profile picture: ${employee.profilePictureFileId}`)
      } catch (imgErr) {
        console.error('[Employee Delete] Failed to delete profile picture:', imgErr)
      }
    }

    // Hard delete the employee from main database
    await Employee.findByIdAndDelete(id)
    console.log(`[Employee Delete] Deleted employee: ${id} (${employee.email})`)

    // Clear cache
    queryCache.delete(queryCache.generateKey(auth.tenant.databaseName, 'employee', id))
    queryCache.clearPattern('employees')

    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'employees:list' })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'auth:user', userId: deletedUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'profile', userId: deletedUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:employee-stats', userId: deletedUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' }))

    // Emit real-time update for employee deletion
    emitEmployeeUpdate({
      action: 'deleted',
      employeeId: id,
      departmentId: employee.department,
    })
    emitDashboardRefresh({ reason: 'employee-deleted' })

    return NextResponse.json({
      success: true,
      message: 'Employee permanently deleted',
      deletedEmployee: {
        _id: employee._id,
        email: employee.email,
        firstName: employee.firstName,
        lastName: employee.lastName,
      },
      userDeleted: !!user,
    })
  } catch (error) {
    console.error('Delete employee error:', error)
    if (error?.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }
    if (error?.name === 'MongoNetworkError' || /buffering timed out/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, message: 'Database connection unavailable' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { success: false, message: 'Failed to delete employee' },
      { status: 500 }
    )
  }
}

// PATCH - Partial update for employee (supports bulk edit)
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Asset'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User, Asset } = models

    if (!Employee || !User) {
      return NextResponse.json(
        { success: false, message: 'Employee models not initialized' },
        { status: 500 }
      )
    }

    const body = await request.json()

    // Check if at least one field is provided
    const allowedFields = ['status', 'department', 'departments', 'designation', 'designationLevel', 'reportingManager', 'level']
    const hasValidField = allowedFields.some(field => body[field] !== undefined && body[field] !== '')

    if (!hasValidField) {
      return NextResponse.json(
        { success: false, message: 'At least one field is required to update' },
        { status: 400 }
      )
    }

    const employeeDoc = await Employee.findById(id).select('status').lean()
    if (!employeeDoc) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    const oldStatus = employeeDoc.status
    const updateData = {}

    // Handle status update
    if (body.status) {
      const validStatuses = ['active', 'inactive', 'terminated', 'resigned', 'on_leave', 'probation']
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        )
      }
      updateData.status = body.status
    }

    // Handle department update
    if (body.department) {
      updateData.department = body.department
    }

    // Handle departments array update
    if (body.departments && Array.isArray(body.departments)) {
      updateData.departments = body.departments.filter(d => d && d !== '')
      // Set primary department if not already set
      if (!updateData.department && updateData.departments.length > 0) {
        updateData.department = updateData.departments[0]
      }
    }

    // Handle designation update
    if (body.designation) {
      updateData.designation = body.designation
    }

    // Handle designation level update
    if (body.designationLevel !== undefined) {
      updateData.designationLevel = parseInt(body.designationLevel)
    }

    // Handle level update (alias for designationLevel)
    if (body.level !== undefined) {
      updateData.designationLevel = parseInt(body.level)
    }

    // Handle reporting manager update
    if (body.reportingManager) {
      updateData.reportingManager = body.reportingManager
    }

    // Apply updates using findByIdAndUpdate to avoid full-document validation
    // (some employees have legacy data like address stored as string instead of object)
    const employee = await Employee.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true, context: 'query' }
    )

    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found after update' },
        { status: 404 }
      )
    }

    // If status changed to terminated or resigned, deactivate the user account
    // Admins cannot be deactivated this way - only superadmin can deactivate admins
    if (updateData.status && ['terminated', 'resigned', 'inactive'].includes(updateData.status)) {
      await User.findOneAndUpdate(
        { employeeId: id, role: { $ne: 'admin' } },
        { isActive: false }
      )

      // Free all assets assigned to this employee
      if (Asset) {
        try {
          const freedAssets = await Asset.updateMany(
            { assignedTo: id },
            { $set: { status: 'available', returnDate: new Date() }, $unset: { assignedTo: 1, assignedDate: 1 } }
          )
          if (freedAssets.modifiedCount > 0) {
            console.log(`[Employee Status] Freed ${freedAssets.modifiedCount} asset(s) for employee ${id} (status: ${updateData.status})`)
            emitAssetUpdate({ action: 'bulk-freed', employeeId: id, count: freedAssets.modifiedCount })
          }
        } catch (assetErr) {
          console.error('[Employee Status] Failed to free assets:', assetErr)
        }
      }
    } else if (updateData.status === 'active' && oldStatus !== 'active') {
      // Reactivate user if status is set back to active
      await User.findOneAndUpdate(
        { employeeId: id },
        { isActive: true }
      )
    }

    // Clear cache - individual employee + employee list caches
    queryCache.delete(queryCache.generateKey(auth.tenant.databaseName, 'employee', id))
    queryCache.clearPattern('employees')

    const employeeUser = await User.findOne({ employeeId: id }).select('_id')
    const employeeUserId = employeeUser?._id?.toString() || '*'

    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'employees:list' })).catch(() => { })
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'auth:user', userId: employeeUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'profile', userId: employeeUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:employee-stats', userId: employeeUserId }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' }))

    // Emit real-time update for employee patch update
    emitEmployeeUpdate({
      action: 'updated',
      employeeId: id,
      updates: updateData,
    })
    emitDashboardRefresh({ reason: 'employee-updated' })

    return NextResponse.json({
      success: true,
      message: 'Employee updated successfully',
      employee: {
        _id: employee._id,
        status: employee.status,
        department: employee.department,
        designation: employee.designation,
        designationLevel: employee.designationLevel,
        reportingManager: employee.reportingManager,
      },
    })
  } catch (error) {
    console.error('Update employee error:', error)
    if (error?.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }
    if (error?.name === 'MongoNetworkError' || /buffering timed out/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, message: 'Database connection unavailable' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { success: false, message: 'Failed to update employee', error: error.message },
      { status: 500 }
    )
  }
}

