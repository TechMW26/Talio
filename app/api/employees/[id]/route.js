import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'
import { logActivity } from '@/lib/activityLogger'
import { deleteUserFromBackup } from '@/lib/backupDb'
import { emitEmployeeUpdate, emitDashboardRefresh } from '@/lib/realtimeEvents'
import mongoose from 'mongoose'

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
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
    const cacheKey = queryCache.generateKey('employee', id)
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
    await setCache(redisCacheKey, response, 2 * 60).catch(() => { })
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
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Designation'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Employee, User, Department, Designation } = models

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
    const objectIdFields = ['company', 'department', 'designation', 'reportingManager'];
    objectIdFields.forEach(field => {
      if (data[field] === '') {
        data[field] = undefined; // Remove from object so Mongoose doesn't try to cast it
      }
    });

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

    // Handle profile picture upload to ImageKit if base64 is provided
    if (data.profilePicture && data.profilePicture.startsWith('data:image/')) {
      console.log('[Employee Update] Processing profile picture upload...')

      try {
        const { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder } = await import('@/lib/imagekit')
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

          // Get the appropriate ImageKit folder
          const imagekitFolder = getImageKitFolder('profile', { employee })

          if (isImageKitConfigured()) {
            console.log('[Employee Update] Uploading to ImageKit...')

            // Build safe tags (no undefined values)
            const safeTags = ['profile', 'avatar', employeeCode].filter(Boolean)

            const imagekitResult = await uploadImageToImageKit(optimizedBuffer, {
              fileName: filename,
              folder: imagekitFolder,
              tags: safeTags,
            })

            // Delete old profile picture from ImageKit if exists
            if (employee.profilePictureFileId) {
              try {
                await deleteFromImageKit(employee.profilePictureFileId)
                console.log(`[Employee Update] Deleted old ImageKit file: ${employee.profilePictureFileId}`)
              } catch (err) {
                console.log('[Employee Update] Old file cleanup:', err.message)
              }
            }

            // Update data with ImageKit URL
            data.profilePicture = imagekitResult.url
            data.profilePictureFileId = imagekitResult.fileId
            console.log(`[Employee Update] Profile picture uploaded to ImageKit: ${imagekitResult.url}`)
          } else {
            console.log('[Employee Update] ImageKit not configured, keeping base64')
          }
        }
      } catch (uploadError) {
        console.error('[Employee Update] Profile picture upload failed:', uploadError.message)
        // Keep the base64 if upload fails (fallback behavior)
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
      .lean()

    // Handle system role update if provided
    if (data.systemRole && ['admin', 'hr', 'manager', 'employee', 'department_head'].includes(data.systemRole)) {
      const user = await User.findOne({ employeeId: id })
      if (user && user.role !== data.systemRole) {
        await User.findByIdAndUpdate(user._id, { role: data.systemRole })
        console.log(`[Employee Update] Updated user role from ${user.role} to ${data.systemRole} for employee ${id}`)
      }
    }

    // Clear cache for this employee and list
    queryCache.delete(queryCache.generateKey('employee', id))
    queryCache.clearPattern('employees')

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

    return NextResponse.json({
      success: true,
      message: 'Employee updated successfully',
      data: updatedEmployee,
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
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User } = models

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

    // Delete profile picture from ImageKit if exists
    if (employee.profilePictureFileId && isImageKitConfigured()) {
      try {
        const { deleteFromImageKit } = await import('@/lib/imagekit')
        await deleteFromImageKit(employee.profilePictureFileId)
        console.log(`[Employee Delete] Deleted profile picture: ${employee.profilePictureFileId}`)
      } catch (imgErr) {
        console.error('[Employee Delete] Failed to delete profile picture:', imgErr)
      }
    }

    // Hard delete the employee from main database
    await Employee.findByIdAndDelete(id)
    console.log(`[Employee Delete] Deleted employee: ${id} (${employee.email})`)

    // Clear cache
    queryCache.delete(queryCache.generateKey('employee', id))

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
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Employee, User } = models

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

    const employee = await Employee.findById(id)
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    const oldStatus = employee.status
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

    // Apply updates
    Object.assign(employee, updateData)
    await employee.save()

    // If status changed to terminated or resigned, deactivate the user account
    if (updateData.status && ['terminated', 'resigned'].includes(updateData.status)) {
      await User.findOneAndUpdate(
        { employeeId: id },
        { isActive: false }
      )
    } else if (updateData.status === 'active' && oldStatus !== 'active') {
      // Reactivate user if status is set back to active
      await User.findOneAndUpdate(
        { employeeId: id },
        { isActive: true }
      )
    }

    // Clear cache
    queryCache.delete(queryCache.generateKey('employee', id))

    const employeeUser = await User.findOne({ employeeId: id }).select('_id')
    const employeeUserId = employeeUser?._id?.toString() || '*'

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

