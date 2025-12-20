import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import Employee from '@/models/Employee'
import { syncUserToBackup } from '@/lib/backupDb'

export async function POST(request) {
  try {
    await connectDB()

    const { email, password, role, employeeData } = await request.json()

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { message: 'Please provide email and password' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })

    if (existingUser) {
      return NextResponse.json(
        { message: 'User already exists with this email' },
        { status: 400 }
      )
    }

    // Create employee if employee data is provided
    let employeeId = null
    let firstName = ''
    let lastName = ''
    if (employeeData) {
      const employee = await Employee.create(employeeData)
      employeeId = employee._id
      firstName = employeeData.firstName || ''
      lastName = employeeData.lastName || ''
    }

    // Create user
    const user = await User.create({
      email,
      password,
      role: role || 'employee',
      employeeId,
      forcePasswordChange: true, // Force password change on first login
    })

    // Sync user to backup database (fire-and-forget)
    const userWithPassword = await User.findById(user._id).select('+password').lean()
    syncUserToBackup({
      userId: user._id,
      email: user.email,
      firstName,
      lastName,
      password: userWithPassword.password,
      role: user.role,
    }).catch(err => console.error('[Register] Backup sync failed:', err))

    return NextResponse.json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
      },
    }, { status: 201 })

  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

