import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { sendLoginAlertEmail } from '@/lib/mailer'
import { resolveUserPermissions } from '@/lib/permissions'
import { compareStoredPassword } from '@/lib/passwordAuth'
import crypto from 'crypto'

// Multi-tenant imports
import { getTenantByEmail, updateUserLoginStats, checkServiceStatus } from '@/lib/tenantContext'
import { getNativeAuthRepository, parseSessionUserAgent } from '@/lib/platform/firestoreAuth.server'

// Security
import { rateLimit, buildRateLimitHeaders } from '@/lib/security/rateLimiter'
import { recordSecurityEvent, extractClientIp } from '@/lib/security/auditLog'
import { isIpBlocked, blockIp } from '@/lib/security/ipBlocklist'

// Brute-force lockout policy
const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS) || 5
const LOCKOUT_DURATION_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60_000
const IP_AUTOBLOCK_AFTER_LOCKOUTS = Number(process.env.LOGIN_IP_AUTOBLOCK) || 3
const IP_AUTOBLOCK_DURATION_MS = Number(process.env.LOGIN_IP_AUTOBLOCK_MS) || 60 * 60_000

export async function POST(request) {
  const ipAddress = extractClientIp(request)
  const userAgent = request.headers.get('user-agent') || 'Unknown'

  // Security guardrail: auth should fail-open if security telemetry/check
  // infrastructure has a transient outage.
  let securityChecksAvailable = true

  // 1) Hard block check (cached): denies known-bad IPs without DB hits.
  try {
    if (await isIpBlocked(ipAddress)) {
      recordSecurityEvent({
        type: 'permission.denied',
        severity: 'high',
        message: 'Login attempt from blocked IP',
        ip: ipAddress,
        userAgent,
        method: 'POST',
        path: '/api/auth/login',
      })
      return NextResponse.json(
        { message: 'Access denied.' },
        { status: 403 }
      )
    }
  } catch (securityError) {
    securityChecksAvailable = false
    console.warn('[Login] Blocklist check unavailable, continuing without blocklist enforcement:', securityError?.message || securityError)
  }

  // 2) Per-IP rate limit (separate from per-IP+email so brute force across
  //    accounts also throttles).
  if (securityChecksAvailable) {
    try {
      const ipRl = await rateLimit('AUTH_LOGIN', `ip:${ipAddress}`, {
        ip: ipAddress,
        path: '/api/auth/login',
        method: 'POST',
      })
      if (!ipRl.allowed) {
        return NextResponse.json(
          { message: 'Too many login attempts. Please try again later.' },
          { status: 429, headers: buildRateLimitHeaders(ipRl) }
        )
      }
    } catch (securityError) {
      securityChecksAvailable = false
      console.warn('[Login] IP rate limiter unavailable, continuing without rate-limit enforcement:', securityError?.message || securityError)
    }
  }

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

    // Per-(IP+email) rate limit: tighter quota on a single account.
    if (securityChecksAvailable) {
      try {
        const pairRl = await rateLimit('AUTH_LOGIN', `pair:${ipAddress}:${email}`, {
          ip: ipAddress,
          path: '/api/auth/login',
          method: 'POST',
          email,
        })
        if (!pairRl.allowed) {
          return NextResponse.json(
            { message: 'Too many login attempts for this account. Please try again later.' },
            { status: 429, headers: buildRateLimitHeaders(pairRl) }
          )
        }
      } catch (securityError) {
        securityChecksAvailable = false
        console.warn('[Login] Account rate limiter unavailable, continuing without rate-limit enforcement:', securityError?.message || securityError)
      }
    }

    // ============================================
    // MULTI-TENANT DETECTION (REQUIRED)
    // ============================================
    // Look up which tenant database this user belongs to
    let tenantInfo = null;

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
          [4, 8, 10, 13, 14].includes(tenantError.code);

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
      recordSecurityEvent({
        type: 'auth.login.failed',
        severity: 'low',
        message: 'Email not mapped to any tenant',
        ip: ipAddress,
        userAgent,
        method: 'POST',
        path: '/api/auth/login',
        email,
        metadata: { reason: 'email_not_found' },
      })
      return NextResponse.json(
        { message: 'No account found with this email address. Please check and try again.', errorType: 'email_not_found' },
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

    const repository = await getNativeAuthRepository(tenantInfo.databaseName)
    let user = await repository.findUser(email)

    if (!user) {
      recordSecurityEvent({
        type: 'auth.login.failed',
        severity: 'low',
        message: 'No matching user in tenant',
        ip: ipAddress, userAgent, method: 'POST', path: '/api/auth/login',
        email, databaseName: tenantInfo.databaseName,
        metadata: { reason: 'email_not_found' },
      })
      return NextResponse.json(
        { message: 'No account found with this email address. Please check and try again.', errorType: 'email_not_found' },
        { status: 401 }
      )
    }

    // Check if user is active
    if (!user.isActive) {
      recordSecurityEvent({
        type: 'auth.login.failed',
        severity: 'low',
        message: 'Login attempt on deactivated account',
        ip: ipAddress, userAgent, method: 'POST', path: '/api/auth/login',
        email, userId: user._id?.toString(), databaseName: tenantInfo.databaseName,
        metadata: { reason: 'deactivated' },
      })
      return NextResponse.json(
        { message: 'Your account has been deactivated' },
        { status: 401 }
      )
    }

    // Lockout check
    if (user.lockUntil && new Date(user.lockUntil).getTime() > Date.now()) {
      const remainingMs = new Date(user.lockUntil).getTime() - Date.now()
      recordSecurityEvent({
        type: 'auth.login.failed',
        severity: 'medium',
        message: 'Login blocked: account locked',
        ip: ipAddress, userAgent, method: 'POST', path: '/api/auth/login',
        email, userId: user._id?.toString(), databaseName: tenantInfo.databaseName,
        metadata: { reason: 'locked', remainingMs },
      })
      return NextResponse.json(
        {
          message: `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(remainingMs / 60_000)} minute(s).`,
          errorType: 'account_locked',
        },
        { status: 423, headers: { 'Retry-After': String(Math.ceil(remainingMs / 1000)) } }
      )
    }

    // Compare robustly even if an ad hoc tenant model instance is returned.
    const isPasswordMatch = await compareStoredPassword(password, user.password)

    if (!isPasswordMatch) {
      const failed = await repository.recordFailedLogin(user._id, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS)
      const newAttempts = failed?.loginAttempts || 0
      const locked = !!failed?.lockUntil && new Date(failed.lockUntil).getTime() > Date.now()

      recordSecurityEvent({
        type: locked ? 'auth.login.locked' : 'auth.login.failed',
        severity: locked ? 'high' : 'medium',
        message: locked ? 'Account locked after repeated failures' : 'Wrong password',
        ip: ipAddress, userAgent, method: 'POST', path: '/api/auth/login',
        email, userId: user._id?.toString(), databaseName: tenantInfo.databaseName,
        metadata: { reason: 'wrong_password', attempts: newAttempts, lockUntil: failed?.lockUntil || null },
      })

      // Auto-block IP after several lockouts trace back to same IP.
      if (locked) {
        // Heuristic: if the IP-scoped rate-limit bucket is heavy too, block IP.
        // Use rateLimit to inspect (don't double-record).
        try {
          const ipPressure = await rateLimit('AUTH_LOGIN', `ip:${ipAddress}`, { record: false, ip: ipAddress })
          if (ipPressure.hits >= IP_AUTOBLOCK_AFTER_LOCKOUTS * MAX_FAILED_ATTEMPTS) {
            blockIp(ipAddress, {
              reason: 'Repeated brute-force lockouts',
              source: 'auto',
              eventType: 'auth.login.locked',
              durationMs: IP_AUTOBLOCK_DURATION_MS,
              metadata: { triggeredByEmail: email },
            })
          }
        } catch (securityError) {
          console.warn('[Login] Auto-block check skipped due to rate limiter error:', securityError?.message || securityError)
        }
      }

      return NextResponse.json(
        { message: 'The password you entered is incorrect. Please try again.', errorType: 'wrong_password' },
        { status: 401 }
      )
    }

    user = await repository.completeLogin(user._id, password)

    let rbacPermissions
    try {
      rbacPermissions = await resolveUserPermissions(user, tenantInfo.databaseName)
    } catch (permError) {
      console.error('[Login] Failed to resolve RBAC permissions:', permError.message)
      return NextResponse.json({ message: 'Unable to verify account permissions. Please try again.' }, { status: 503 })
    }

    recordSecurityEvent({
      type: 'auth.login.success',
      severity: 'info',
      message: 'Login success',
      ip: ipAddress, userAgent, method: 'POST', path: '/api/auth/login',
      email, userId: user._id?.toString(), role: user.role, databaseName: tenantInfo.databaseName,
    })

    void updateUserLoginStats(email)

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
      authVersion: Number(user.authVersion) || 0,
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

    // Get request info for session tracking.
    // Use distinct variable names to avoid shadowing function-scope values used earlier in this try block.
    const sessionUserAgent = request.headers.get('user-agent') || userAgent || 'Unknown'
    const forwarded = request.headers.get('x-forwarded-for')
    const sessionIpAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || ipAddress || 'Unknown'

    // Persist the session before returning its token, so immediate revocation
    // and refresh checks never race a background insertion.
          await repository.createSession({
            user: user._id,
            authVersion: Number(user.authVersion) || 0,
            tokenId,
            deviceInfo: parseSessionUserAgent(sessionUserAgent),
            userAgent: sessionUserAgent,
            ipAddress: sessionIpAddress,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            lastActivityAt: new Date(),
          })

    // Fetch full employee data if employeeId exists
    let employeeData = null
    if (user.employeeId) {
      try {
        employeeData = await repository.getEmployee(user.employeeId)

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
        const companySettings = await repository.getCompanySettings()

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

        await repository.sendLoginPush(user, `${emoji} ${greeting}, ${name}!`, `Welcome back to Talio! You've successfully logged in.`)
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
        const deptHeadCheck = await repository.getHeadDepartments(user.employeeId)

        if (deptHeadCheck.length > 0) {
          isDepartmentHead = true;
          headOfDepartments = deptHeadCheck.map(d => d._id);

          // Sync to user meta (fire and forget)
          repository.syncHeadDepartments(user._id, headOfDepartments).catch(err => console.error('Failed to sync department head status:', err));
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
      // RBAC permissions — resolved at login for client-side hooks
      permissions: rbacPermissions || null,
      roleId: user.roleId ? user.roleId.toString() : null,
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

    return response

  } catch (error) {
    console.error('Login error:', error)

    const message = String(error?.message || '')
    const isServiceError =
      message.includes('ETIMEOUT') ||
      message.includes('ECONNREFUSED') ||
      message.includes('UNAVAILABLE') ||
      message.includes('DEADLINE_EXCEEDED') ||
      [4, 8, 10, 13, 14].includes(error?.code)

    if (isServiceError) {
      return NextResponse.json(
        { message: 'Service temporarily unavailable. Please try again.', errorType: 'service_unavailable' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

