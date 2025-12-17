import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Employee from '@/models/Employee'
import User from '@/models/User'
import Department from '@/models/Department'
import Designation from '@/models/Designation'
import Company from '@/models/Company'
import queryCache from '@/lib/queryCache'
import { logActivity } from '@/lib/activityLogger'

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
    await connectDB()

    const data = await request.json()

    // Check if employee exists
    const employee = await Employee.findById(params.id).lean()
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

    const updatedEmployee = await Employee.findByIdAndUpdate(
      params.id,
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
    queryCache.delete(queryCache.generateKey('employee', params.id))
    queryCache.clearPattern('employees')

    // Log activity for profile update
    await logActivity({
      employeeId: params.id,
      type: 'profile_update',
      action: 'Updated profile',
      details: 'Profile information updated',
      relatedModel: 'Employee',
      relatedId: params.id
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
    await connectDB()

    const employee = await Employee.findById(params.id)
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Soft delete - change status to terminated
    await Employee.findByIdAndUpdate(params.id, { status: 'terminated' })

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

