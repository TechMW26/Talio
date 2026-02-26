import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { sendLoginAlertEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { warmDashboardCaches } from '@/lib/cacheWarming'
import crypto from 'crypto'

// Multi-tenant imports
import { getTenantByEmail, updateUserLoginStats, checkServiceStatus } from '@/lib/tenantContext'
import { getTenantModels } from '@/lib/tenantModels'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawEmail = body.email
    const password = body.password

    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : ''

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { message: 'Please provide email and password' },
        { status: 400 }
      )
    }

    // ============================================
    // MULTI-TENANT DETECTION (REQUIRED)
    // ============================================
    // Look up which tenant database this user belongs to
    let tenantInfo = null;
    let TenantUser, TenantEmployee, TenantDepartment, TenantDesignation, TenantUserSession, TenantCompanySettings, TenantNotification;

    // Retry logic for transient network errors (e.g., DNS timeouts)
    const MAX_RETRIES = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        tenantInfo = await getTenantByEmail(email);
        break; // Success, exit retry loop
      } catch (tenantError) {
        lastError = tenantError;
        console.error(`[Login] Tenant lookup attempt ${attempt}/${MAX_RETRIES} failed:`, tenantError.message);

        // Check if it's a transient error worth retrying
        const isTransient = tenantError.message.includes('ETIMEOUT') ||
          tenantError.message.includes('ECONNREFUSED') ||
          tenantError.message.includes('querySrv');

        if (isTransient && attempt < MAX_RETRIES) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        // Non-transient error or max retries reached
        console.error('[Login] Tenant lookup failed after retries:', tenantError.message);
        return NextResponse.json(
          { message: 'Service temporarily unavailable. Please try again.' },
          { status: 503 }
        );
      }
    }

    if (!tenantInfo) {
      // SECURITY: No tenant mapping = no access
      console.warn(`[Login] No tenant mapping found for ${email} - access denied`);
      return NextResponse.json(
        { message: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check if tenant service is active
    const serviceCheck = await checkServiceStatus(tenantInfo.databaseName);
    if (!serviceCheck.active) {
      return NextResponse.json(
        { message: serviceCheck.reason || 'Service is currently unavailable' },
        { status: 403 }
      );
    }

    console.log(`[Login] User ${email} belongs to tenant: ${tenantInfo.companySlug} (${tenantInfo.databaseName})`);

    // Get models bound to tenant database
    const tenantModels = await getTenantModels(tenantInfo.databaseName, [
      'User', 'Employee', 'Department', 'Designation', 'UserSession', 'CompanySettings', 'Notification'
    ]);

    TenantUser = tenantModels.User;
    TenantEmployee = tenantModels.Employee;
    TenantDepartment = tenantModels.Department;
    TenantDesignation = tenantModels.Designation;
    TenantUserSession = tenantModels.UserSession;
    TenantCompanySettings = tenantModels.CompanySettings;
    TenantNotification = tenantModels.Notification;

    // Find user and include password field (forcePasswordChange and isActive are included by default)
    const user = await TenantUser.findOne({ email }).select('+password')

    if (!user) {
      return NextResponse.json(
        { message: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Check if user is active
    if (!user.isActive) {
      return NextResponse.json(
        { message: 'Your account has been deactivated' },
        { status: 401 }
      )
    }

    // Check password using bcrypt comparison
    let isPasswordMatch = false

    try {
      isPasswordMatch = await user.comparePassword(password)
    } catch (error) {
      // Fallback for legacy users with plain text passwords (one-time migration)
      // This is a security migration feature - upgrades plain text to hashed
      if (user.password === password) {
        isPasswordMatch = true
        // Upgrade to hashed password
        user.password = password // This will trigger the pre-save hook to hash it
        await user.save({ validateBeforeSave: false })
      }
    }

    if (!isPasswordMatch) {
      return NextResponse.json(
        { message: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Update last login and set firstLoginAt if not set (for profile completion tracking)
    const lastLogin = new Date()
    try {
      const updateData = { lastLogin }

      // Set firstLoginAt and profileCompletionDeadline on first login (after password change)
      if (!user.forcePasswordChange && !user.profileCompletion?.firstLoginAt) {
        const deadline = new Date()
        deadline.setDate(deadline.getDate() + 7) // 7 days from now

        updateData['profileCompletion.firstLoginAt'] = lastLogin
        updateData['profileCompletion.profileCompletionDeadline'] = deadline

        console.log('[Login] Setting first login and profile completion deadline:', deadline)
      }

      await TenantUser.updateOne(
        { _id: user._id },
        { $set: updateData },
        { timestamps: false }
      )
      user.lastLogin = lastLogin

      // Update tenant login stats (fire and forget)
      if (tenantInfo) {
        updateUserLoginStats(email).catch(err =>
          console.warn('[Login] Failed to update tenant login stats:', err.message)
        );
      }
    } catch (error) {
      console.error('Failed to update lastLogin:', error)
    }

    // Create JWT token
    const secretValue = process.env.JWT_SECRET
    if (!secretValue) {
      console.error('JWT_SECRET environment variable is missing')
      return NextResponse.json(
        { message: 'Server configuration error. Please contact support.' },
        { status: 500 }
      )
    }

    // Generate unique token ID for session tracking
    const tokenId = crypto.randomBytes(16).toString('hex')

    const secret = new TextEncoder().encode(secretValue)
    const token = await new SignJWT({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenId, // Include tokenId for session management
      // Multi-tenant info - included in JWT for API route authorization
      ...(tenantInfo && {
        databaseName: tenantInfo.databaseName,
        companySlug: tenantInfo.companySlug,
        companyName: tenantInfo.companyName,
      }),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)

    // Get request info for session tracking
    const userAgent = request.headers.get('user-agent') || 'Unknown'
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'Unknown'

      // Create UserSession record (fire and forget)
      ; (async () => {
        try {
          const deviceInfo = TenantUserSession.parseUserAgent ?
            TenantUserSession.parseUserAgent(userAgent) :
            { browser: 'Unknown', isMobile: false, device: 'Unknown' }
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

          await TenantUserSession.create({
            user: user._id,
            tokenId,
            deviceInfo,
            userAgent,
            ipAddress,
            expiresAt,
            lastActivityAt: new Date(),
          })

          console.log(`[Login] Session created for user ${user._id} with tokenId ${tokenId}`)
        } catch (sessionError) {
          console.error('Failed to create user session:', sessionError)
        }
      })()

    // Fetch full employee data if employeeId exists
    let employeeData = null
    if (user.employeeId) {
      try {
        employeeData = await TenantEmployee.findById(user.employeeId)
          .populate('designation')
          .populate('department')
          .populate('reportingManager', 'firstName lastName email')
          .lean()

        if (employeeData) {
          console.log('Employee data fetched successfully:', employeeData.firstName, employeeData.lastName)
        }
      } catch (error) {
        console.error('Error fetching employee data:', error)
      }
    }

    // Best-effort: send login alert email to the user (controlled by admin settings) - fire and forget
    (async () => {
      try {
        const companySettings = await TenantCompanySettings.findOne().lean().catch(() => null)

        const emailNotificationsEnabled =
          companySettings?.notifications?.emailNotifications !== false

        const loginEmailEnabled =
          companySettings?.notifications?.emailEvents?.login !== false

        if (emailNotificationsEnabled && loginEmailEnabled) {
          const userAgent = request.headers.get('user-agent') || undefined
          const ipAddress =
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') ||
            undefined

          const name = employeeData
            ? [employeeData.firstName, employeeData.lastName].filter(Boolean).join(' ')
            : undefined

          await sendLoginAlertEmail({
            to: user.email,
            name,
            loginTime: user.lastLogin || new Date(),
            userAgent,
            ipAddress,
          })
        }
      } catch (emailError) {
        console.error('Failed to send login alert email:', emailError)
      }
    })();

    // Best-effort: send push notification for login - fire and forget
    ; (async () => {
      try {
        const name = employeeData
          ? [employeeData.firstName, employeeData.lastName].filter(Boolean).join(' ')
          : user.email.split('@')[0]

        const currentHour = new Date().getHours()
        let greeting = 'Hello'
        let emoji = '👋'
        if (currentHour < 12) {
          greeting = 'Good Morning'
          emoji = '🌅'
        } else if (currentHour < 17) {
          greeting = 'Good Afternoon'
          emoji = '☀️'
        } else {
          greeting = 'Good Evening'
          emoji = '🌙'
        }

        await sendPushToUser(
          user._id,
          {
            title: `${emoji} ${greeting}, ${name}!`,
            body: `Welcome back to Talio! You've successfully logged in.`,
          },
          {
            eventType: 'login',
            clickAction: '/dashboard',
            icon: '/icon-192x192.png',
            data: {
              loginTime: new Date().toISOString(),
              type: 'login',
            },
            models: { User: TenantUser, Notification: TenantNotification }
          }
        )
      } catch (pushError) {
        console.error('Failed to send login push notification:', pushError)
      }
    })()

    // Return user data without password, including employee details
    // IMPORTANT: employeeId is stored as an object with _id for frontend compatibility

    // Get department head info from user meta (or check departments if not synced)
    let isDepartmentHead = user.isDepartmentHead || false;
    let headOfDepartments = user.headOfDepartments || [];

    // If not in user meta, check Department model (fallback for existing data)
    if (!isDepartmentHead && user.employeeId) {
      try {
        const deptHeadCheck = await TenantDepartment.find({
          isActive: true,
          $or: [
            { head: user.employeeId },
            { heads: user.employeeId }
          ]
        }).select('_id name').lean();

        if (deptHeadCheck.length > 0) {
          isDepartmentHead = true;
          headOfDepartments = deptHeadCheck.map(d => d._id);

          // Sync to user meta (fire and forget)
          TenantUser.updateOne(
            { _id: user._id },
            { $set: { isDepartmentHead: true, headOfDepartments } }
          ).catch(err => console.error('Failed to sync department head status:', err));
        }
      } catch (error) {
        console.error('Error checking department head status:', error);
      }
    }

    const userData = {
      id: user._id.toString(),
      _id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      // Multi-tenant info - for frontend to know which company user belongs to
      ...(tenantInfo && {
        tenant: {
          databaseName: tenantInfo.databaseName,
          companySlug: tenantInfo.companySlug,
          companyName: tenantInfo.companyName,
        },
      }),
      // Department head meta - allows department heads to use special features regardless of role
      isDepartmentHead,
      headOfDepartments: headOfDepartments.map(d => d.toString()),
      // Force password change flag - true for first login
      forcePasswordChange: user.forcePasswordChange === true,
      // Profile completion status for modal display
      profileCompletion: user.profileCompletion ? {
        status: user.profileCompletion.status || 'incomplete',
        firstLoginAt: user.profileCompletion.firstLoginAt,
        profileCompletionDeadline: user.profileCompletion.profileCompletionDeadline,
        completedAt: user.profileCompletion.completedAt,
        completedFields: user.profileCompletion.completedFields || {
          personalInfo: false,
          aadhaarUploaded: false,
          ocrVerified: false
        }
      } : {
        status: 'incomplete',
        completedFields: {
          personalInfo: false,
          aadhaarUploaded: false,
          ocrVerified: false
        }
      },
      // Store employeeId as both string and object for compatibility
      employeeId: employeeData ? {
        _id: user.employeeId.toString(),
        id: user.employeeId.toString(),
        employeeCode: employeeData.employeeCode,
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        email: employeeData.email,
        phone: employeeData.phone,
        dateOfBirth: employeeData.dateOfBirth,
        gender: employeeData.gender,
        address: employeeData.address,
        designation: employeeData.designation,
        department: employeeData.department,
        departments: employeeData.departments,
        profilePicture: employeeData.profilePicture,
        status: employeeData.status,
        dateOfJoining: employeeData.dateOfJoining,
        reportingManager: employeeData.reportingManager,
        emergencyContact: employeeData.emergencyContact,
      } : user.employeeId ? { _id: user.employeeId.toString(), id: user.employeeId.toString() } : null,
      // Also include top-level employee data for easy access
      ...(employeeData && {
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        profilePicture: employeeData.profilePicture,
        designation: employeeData.designation,
        designationLevel: employeeData.designationLevel,
        designationLevelName: employeeData.designationLevelName,
        department: employeeData.department,
        departments: employeeData.departments,
        employeeCode: employeeData.employeeCode,
        phone: employeeData.phone,
        dateOfBirth: employeeData.dateOfBirth,
        gender: employeeData.gender,
        address: employeeData.address,
        status: employeeData.status,
      })
    }

    // Create response with Set-Cookie header for reliable cookie setting
    // This ensures the middleware can read the token on subsequent requests
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      token,
      user: userData,
    })

    // Set token cookie from server - more reliable than client-side document.cookie
    response.cookies.set('token', token, {
      httpOnly: false, // Allow client-side access for logout/reading
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    })

    // 🔥 Pre-warm Redis caches for dashboard APIs in the background
    // This ensures the first dashboard load after login hits warm caches
    warmDashboardCaches({
      token,
      role: user.role,
      employeeId: user.employeeId?.toString() || '',
      userId: user._id.toString(),
    })

    return response

  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

