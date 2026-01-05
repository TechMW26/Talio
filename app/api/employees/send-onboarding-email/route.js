import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import crypto from 'crypto'

/**
 * POST - Send/resend onboarding email to an employee by email address
 * This creates a new onboarding email record and sends the email
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'OnboardingEmail', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, User, OnboardingEmail, CompanySettings } = models
    
    // Only admin and HR can send onboarding emails
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { email, resetPassword } = body

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 })
    }

    // Find the employee by email
    const employee = await Employee.findOne({ email: email.toLowerCase().trim() })
      .populate('department', 'name')
      .populate('designation', 'title')
      .lean()

    if (!employee) {
      return NextResponse.json({ success: false, message: `Employee not found with email: ${email}` }, { status: 404 })
    }

    // Find the associated user
    const targetUser = await User.findOne({ email: email.toLowerCase().trim() })

    if (!targetUser) {
      return NextResponse.json({ success: false, message: `User account not found for: ${email}` }, { status: 404 })
    }

    // Generate a new password if resetPassword is true, otherwise use a placeholder
    let password = 'employee123' // Default password
    
    if (resetPassword) {
      // Generate a random password
      password = crypto.randomBytes(4).toString('hex') + '1!' // 8 chars + special char
      
      // Hash and update the user's password
      const bcrypt = await import('bcryptjs')
      const hashedPassword = await bcrypt.hash(password, 10)
      await User.findByIdAndUpdate(targetUser._id, { 
        password: hashedPassword,
        forcePasswordChange: true 
      })
    }

    // Send the onboarding email
    const result = await sendAndLogOnboardingEmail({
      employeeId: employee._id,
      userId: targetUser._id,
      to: email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: email,
      password: password,
      employeeCode: employee.employeeCode,
      designation: employee.designation?.title || employee.designationLevelName,
      department: employee.department?.name,
      dateOfJoining: employee.dateOfJoining,
      triggeredBy: 'manual_retry',
      retriedBy: user._id || user.userId,
      forceEnabled: true, // Bypass the enabled check for manual sends
      models: { OnboardingEmail, CompanySettings },
    })

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Onboarding email sent successfully to ${email}`,
        data: {
          emailLogId: result.emailLogId,
          passwordReset: resetPassword,
          newPassword: resetPassword ? password : null,
        }
      })
    } else if (result.skipped) {
      return NextResponse.json({
        success: false,
        message: result.error || 'Email was skipped',
        skipped: true,
      }, { status: 400 })
    } else {
      return NextResponse.json({
        success: false,
        message: result.error || 'Failed to send email',
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Send onboarding email error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to send onboarding email' },
      { status: 500 }
    )
  }
}
