import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Employee from '@/models/Employee'
import User from '@/models/User'
import Department from '@/models/Department'
import Designation from '@/models/Designation'
import Company from '@/models/Company'
import queryCache from '@/lib/queryCache'
import { logActivity } from '@/lib/activityLogger'
import { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

// Ensure models are registered for populate
const _ensureModels = { Department, Designation, Company };

// GET - Get single employee
export async function GET(request, { params }) {
  try {
    // Await params in Next.js 15
    const { id } = await params;

    await connectDB()

    // Check cache first
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
      const userWithEmployee = await User.findById(params.id).select('employeeId').lean()
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
    const user = await User.findOne({ employeeId: employee._id })
      .select('_id email role')
      .lean()

    // Add user data to employee
    const employeeWithUser = {
      ...employee,
      userId: user || null
    }

    const response = {
      success: true,
      data: employeeWithUser,
    }

    // Cache for 60 seconds
    queryCache.set(cacheKey, response, 60000)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get employee error:', error)
    console.error('Error stack:', error.stack)
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

    await connectDB()

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

    return NextResponse.json({
      success: true,
      message: 'Employee updated successfully',
      data: updatedEmployee,
    })
  } catch (error) {
    console.error('Update employee error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update employee' },
      { status: 500 }
    )
  }
}

// DELETE - Delete employee
export async function DELETE(request, { params }) {
  try {
    // Await params in Next.js 15
    const { id } = await params;

    await connectDB()

    const employee = await Employee.findById(id)
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Soft delete - change status to terminated
    await Employee.findByIdAndUpdate(id, { status: 'terminated' })

    return NextResponse.json({
      success: true,
      message: 'Employee deleted successfully',
    })
  } catch (error) {
    console.error('Delete employee error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete employee' },
      { status: 500 }
    )
  }
}

