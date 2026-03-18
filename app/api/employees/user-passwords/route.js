import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { decryptPassword, maskPassword } from '@/lib/passwordEncryption'

/**
 * GET - Fetch all users with their onboarding password status
 * Only admin and HR can access this.
 * 
 * SECURITY:
 * - Passwords are stored as AES-256-GCM encrypted values in `encryptedOnboardingPassword`
 * - List responses return MASKED passwords only (e.g., "Mar***")
 * - Full password reveal requires a separate POST call to /api/employees/user-passwords/reveal
 * - Every access is logged to PasswordAuditLog
 * - Users who have changed their password (forcePasswordChange: false) have their
 *   encrypted password wiped - admin sees "Password changed by user" instead
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'PasswordAuditLog'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, PasswordAuditLog } = models

    // RBAC: Only admin and HR can access this
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied. Only Admin and HR can view user passwords.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 50
    const search = searchParams.get('search') || ''
    const filter = searchParams.get('filter') || 'all' // 'all', 'with-password', 'without-password'

    const skip = (page - 1) * limit

    // Build search query
    let matchStage = {}
    if (search) {
      matchStage.$or = [
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    // Get all users with encryptedOnboardingPassword field from DB
    const users = await User.find(matchStage, {
      email: 1,
      role: 1,
      isActive: 1,
      forcePasswordChange: 1,
      createdAt: 1,
      updatedAt: 1,
      employeeId: 1,
      encryptedOnboardingPassword: 1,  // This overrides schema's select: false
    })
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode department designation',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'designation', select: 'title' }
        ]
      })
      .sort({ createdAt: -1 })
      .lean()

    // Map results - decrypt and MASK passwords for list view
    let results = users.map(u => {
      const employee = u.employeeId

      // Determine password state
      let passwordMasked = null
      let hasPassword = false
      let passwordStatus = 'unknown'

      if (!u.forcePasswordChange && !u.encryptedOnboardingPassword) {
        // User has changed their password - encrypted value should be wiped
        passwordStatus = 'changed_by_user'
        hasPassword = false
      } else if (u.encryptedOnboardingPassword) {
        // Decrypt to get the real password, then mask it for list view
        const decrypted = decryptPassword(u.encryptedOnboardingPassword)
        if (decrypted) {
          passwordMasked = maskPassword(decrypted)
          hasPassword = true
          passwordStatus = u.forcePasswordChange ? 'must_change' : 'active'
        } else {
          passwordStatus = 'decryption_failed'
          hasPassword = false
        }
      } else {
        passwordStatus = 'not_available'
        hasPassword = false
      }

      return {
        _id: u._id,
        email: u.email,
        firstName: employee?.firstName || '',
        lastName: employee?.lastName || '',
        employeeCode: employee?.employeeCode || '',
        department: employee?.department?.name || '',
        designation: employee?.designation?.title || '',
        role: u.role,
        isActive: u.isActive,
        password: passwordMasked, // MASKED - never the real password in list responses
        hasPassword,
        passwordStatus,
        forcePasswordChange: u.forcePasswordChange,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }
    })

    // Filter by name if search includes name
    if (search) {
      const searchLower = search.toLowerCase()
      results = results.filter(r =>
        r.email?.toLowerCase().includes(searchLower) ||
        r.firstName?.toLowerCase().includes(searchLower) ||
        r.lastName?.toLowerCase().includes(searchLower) ||
        r.employeeCode?.toLowerCase().includes(searchLower)
      )
    }

    // Apply password filter
    if (filter === 'with-password') {
      results = results.filter(r => r.hasPassword)
    } else if (filter === 'without-password') {
      results = results.filter(r => !r.hasPassword)
    }

    const total = results.length
    const paginatedResults = results.slice(skip, skip + limit)

    // Stats
    const withPassword = results.filter(r => r.hasPassword).length
    const withoutPassword = results.filter(r => !r.hasPassword).length

    // Audit log: record that an admin listed passwords
    try {
      await PasswordAuditLog.create({
        action: 'list_passwords',
        performedBy: user._id || user.userId,
        performedByEmail: user.email,
        performedByRole: user.role,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        metadata: { page, limit, filter, search: search || null, resultCount: paginatedResults.length },
      })
    } catch (auditError) {
      // Don't fail the request if audit logging fails
      console.error('[UserPasswords] Audit log error:', auditError.message)
    }

    return NextResponse.json({
      success: true,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        total: results.length,
        withPassword,
        withoutPassword,
      }
    })
  } catch (error) {
    console.error('Get user passwords error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch user passwords' },
      { status: 500 }
    )
  }
}
