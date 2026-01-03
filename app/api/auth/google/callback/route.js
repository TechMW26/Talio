import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import crypto from 'crypto'
import { getTenantByEmail, checkServiceStatus } from '@/lib/tenantContext'
import { getTenantModels } from '@/lib/tenantModels'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

// Helper to check if this is a mail connection request
function parseMailState(stateParam) {
  if (!stateParam) return null;
  try {
    // Try base64url decoding first (used by mail OAuth)
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
    if (decoded.type === 'mail_connect') {
      return decoded;
    }
  } catch (e) {
    // Try regular base64 as fallback
    try {
      const decoded = JSON.parse(Buffer.from(stateParam, 'base64').toString());
      if (decoded.type === 'mail_connect') {
        return decoded;
      }
    } catch (e2) {
      // Not a mail state, that's fine
    }
  }
  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state')

    console.log('🔵 Google OAuth Callback - Start')
    console.log('Code received:', code ? 'Yes' : 'No')
    console.log('Error from Google:', error)
    console.log('State received:', state ? 'Yes' : 'No')

    // Always use production URL for Google OAuth to avoid localhost issues
    const productionUrl = 'https://app.talio.in'
    const isProduction = request.nextUrl.origin.includes('app.talio.in') || 
      request.nextUrl.origin.includes('talio.in')
    const isLocalhost = request.nextUrl.origin.includes('localhost')
    const baseUrl = (isProduction || isLocalhost) ? productionUrl : (process.env.NEXT_PUBLIC_APP_URL || productionUrl)

    // Check if this is a mail connection request
    const mailState = parseMailState(state);
    
    if (mailState) {
      console.log('📧 This is a MAIL connection request')
      return handleMailCallback(request, code, error, mailState, baseUrl);
    }

    console.log('🔐 This is a LOGIN request')
    console.log('Request origin:', request.nextUrl.origin)
    console.log('Base URL:', baseUrl)

    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(new URL(`/login?error=${error}`, baseUrl))
    }

    if (!code) {
      console.error('No authorization code received')
      return NextResponse.redirect(new URL('/login?error=no_code', baseUrl))
    }

    // Prepare token exchange parameters
    const redirectUri = `${baseUrl}/api/auth/google/callback`
    console.log('Redirect URI:', redirectUri)
    console.log('Client ID:', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('❌ Token exchange failed:', errorText)
      return NextResponse.redirect(new URL('/login?error=token_exchange_failed', baseUrl))
    }

    console.log('✅ Token exchange successful')

    const tokens = await tokenResponse.json()
    console.log('✅ Tokens received')

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text()
      console.error('❌ Failed to get user info:', errorText)
      return NextResponse.redirect(new URL('/login?error=user_info_failed', baseUrl))
    }

    const googleUser = await userInfoResponse.json()
    console.log('✅ Google user info received:', googleUser.email)

    // ============================================
    // MULTI-TENANT LOOKUP
    // ============================================
    let tenantInfo = null;
    try {
      tenantInfo = await getTenantByEmail(googleUser.email);
    } catch (tenantError) {
      console.error('[Google Login] Tenant lookup failed:', tenantError.message);
      return NextResponse.redirect(new URL('/login?error=user_not_found', baseUrl));
    }
    
    if (!tenantInfo) {
      console.warn(`[Google Login] No tenant mapping found for ${googleUser.email} - access denied`);
      return NextResponse.redirect(new URL('/login?error=user_not_found', baseUrl));
    }
    
    // Check if tenant service is active
    const serviceCheck = await checkServiceStatus(tenantInfo.databaseName);
    if (!serviceCheck.active) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(serviceCheck.reason || 'service_unavailable')}`, baseUrl));
    }
    
    console.log(`[Google Login] User ${googleUser.email} belongs to tenant: ${tenantInfo.companySlug} (${tenantInfo.databaseName})`);
    
    // Get tenant-specific models
    const tenantModels = await getTenantModels(tenantInfo.databaseName, [
      'User', 'Employee', 'UserSession'
    ]);
    
    const TenantUser = tenantModels.User;
    const TenantEmployee = tenantModels.Employee;
    const TenantUserSession = tenantModels.UserSession;
    console.log('✅ Connected to tenant database')

    // Check if user exists in database
    let user = await TenantUser.findOne({ email: googleUser.email })
    console.log('User found in database:', user ? 'Yes' : 'No')

    // Only allow login if user exists in database
    if (!user) {
      console.log('❌ Google login attempt for non-existent user:', googleUser.email)
      return NextResponse.redirect(new URL('/login?error=user_not_found', baseUrl))
    }

    // Check if user is active
    if (!user.isActive) {
      console.log('❌ User account is deactivated:', googleUser.email)
      return NextResponse.redirect(new URL('/login?error=account_deactivated', baseUrl))
    }

    console.log('✅ User is active')

    // Fetch employee data separately to avoid populate issues
    let employeeData = null
    if (user.employeeId) {
      try {
        employeeData = await TenantEmployee.findById(user.employeeId)
          .populate('designation')
          .populate('department')
          .populate('reportingManager', 'firstName lastName email')
          .lean()
        console.log('✅ Employee data fetched:', employeeData?.firstName, employeeData?.lastName)
      } catch (error) {
        console.error('⚠️ Error fetching employee data:', error)
      }
    }

    // Update last login and clear forcePasswordChange (Google OAuth users don't need to change password)
    try {
      await TenantUser.updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date(), forcePasswordChange: false } },
        { timestamps: false }
      )
      console.log('✅ Last login updated, forcePasswordChange cleared')
    } catch (error) {
      console.error('⚠️ Failed to update lastLogin:', error)
    }

    // Create JWT token with tenant info
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    
    // Generate unique token ID for session tracking
    const tokenId = crypto.randomBytes(16).toString('hex')
    
    const token = await new SignJWT({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenId, // Include tokenId for session management
      // Include tenant info for multi-tenant support
      databaseName: tenantInfo.databaseName,
      companySlug: tenantInfo.companySlug,
      companyName: tenantInfo.companyName,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)

    console.log('✅ JWT token created with tenant info')

    // Get request info for session tracking
    const userAgent = request.headers.get('user-agent') || 'Unknown'
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'Unknown'

    // Create UserSession record (fire and forget)
    ;(async () => {
      try {
        const deviceInfo = TenantUserSession.parseUserAgent ? TenantUserSession.parseUserAgent(userAgent) : { browser: userAgent }
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

        console.log(`[Google OAuth] Session created for user ${user._id} with tokenId ${tokenId}`)
      } catch (sessionError) {
        console.error('Failed to create user session:', sessionError)
      }
    })()

    // Prepare user data for response (similar to login API)
    // IMPORTANT: employeeId is stored as an object with _id for frontend compatibility
    const userData = {
      id: user._id.toString(),
      _id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      forcePasswordChange: false, // Google OAuth users don't need to change password
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
        designation: employeeData.designation,
        department: employeeData.department,
        profilePicture: employeeData.profilePicture,
        status: employeeData.status,
        dateOfJoining: employeeData.dateOfJoining,
        reportingManager: employeeData.reportingManager,
      } : user.employeeId ? { _id: user.employeeId.toString(), id: user.employeeId.toString() } : null,
      // Also include top-level employee data for easy access
      ...(employeeData && {
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        profilePicture: employeeData.profilePicture,
        designation: employeeData.designation,
        department: employeeData.department,
        employeeCode: employeeData.employeeCode,
        phone: employeeData.phone,
        status: employeeData.status,
      })
    }

    console.log('✅ User data prepared:', {
      email: userData.email,
      role: userData.role,
      firstName: userData.firstName,
      lastName: userData.lastName
    })

    // Check if this is a desktop login request
    let desktopLogin = false;
    if (state) {
      try {
        // Use Buffer for Node.js environment
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
        if (decoded.type === 'desktop_login') {
          desktopLogin = true;
        }
      } catch (e) {
        console.log('Failed to parse state:', e);
      }
    }

    if (desktopLogin) {
       console.log('🖥️ Desktop login detected, redirecting to talio://');
       // Redirect to custom protocol - encode user data as base64 to avoid URL encoding issues
       const userBase64 = Buffer.from(JSON.stringify(userData)).toString('base64');
       const redirectUrl = `talio://auth?token=${encodeURIComponent(token)}&user=${encodeURIComponent(userBase64)}`;
       console.log('🖥️ Redirect URL:', redirectUrl);
       return NextResponse.redirect(redirectUrl);
    }

    // Create response with redirect to auth callback page
    // This page will transfer cookie data to localStorage
    // IMPORTANT: Use baseUrl to ensure correct domain
    console.log('🔵 Redirecting to:', baseUrl + '/auth/callback')
    const response = NextResponse.redirect(new URL('/auth/callback', baseUrl))

    // Set token cookie (httpOnly for security)
    response.cookies.set('token', token, {
      httpOnly: false, // Changed to false so client can read it
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })

    // Set user data in cookie for client-side access
    response.cookies.set('user', JSON.stringify(userData), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    })

    console.log('✅ Google OAuth login successful for:', googleUser.email)
    console.log('🔵 Redirecting to auth callback page to set localStorage')

    return response

  } catch (error) {
    console.error('❌ Google OAuth callback error:', error)
    console.error('Error stack:', error.stack)
    // Always redirect to production URL to avoid localhost issues
    const baseUrl = 'https://app.talio.in'
    return NextResponse.redirect(new URL('/login?error=authentication_failed', baseUrl))
  }
}

// Handle mail connection callback
async function handleMailCallback(request, code, error, mailState, baseUrl) {
  try {
    console.log('📧 Mail OAuth Callback - Processing')
    console.log('User ID from state:', mailState.userId)

    if (error) {
      console.error('📧 Mail OAuth error:', error)
      return NextResponse.redirect(new URL(`/dashboard/mail?error=${encodeURIComponent(error)}`, baseUrl))
    }

    if (!code) {
      console.error('📧 No authorization code received')
      return NextResponse.redirect(new URL('/dashboard/mail?error=no_code', baseUrl))
    }

    // Check if state is not too old (10 minutes max for mail)
    if (Date.now() - mailState.timestamp > 10 * 60 * 1000) {
      console.error('📧 State token expired')
      return NextResponse.redirect(new URL('/dashboard/mail?error=expired', baseUrl))
    }

    // Get tenant from the state (added during OAuth flow) or from superadmin lookup
    let databaseName = mailState.databaseName;
    if (!databaseName) {
      // Fallback: lookup user's tenant from superadmin DB
      const { getTenantByUserId } = await import('@/lib/tenantContext');
      const tenantInfo = await getTenantByUserId(mailState.userId);
      if (!tenantInfo) {
        console.error('📧 User not found in tenant mappings:', mailState.userId);
        return NextResponse.redirect(new URL('/dashboard/mail?error=unauthorized', baseUrl));
      }
      databaseName = tenantInfo.databaseName;
    }

    // Get tenant-specific EmailAccount model
    const tenantModels = await getTenantModels(databaseName, ['EmailAccount']);
    const TenantEmailAccount = tenantModels.EmailAccount;

    const redirectUri = `${baseUrl}/api/auth/google/callback`
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET

    console.log('📧 Exchanging code for tokens...')
    console.log('📧 Redirect URI:', redirectUri)

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('📧 Token exchange failed:', errorText)
      return NextResponse.redirect(new URL('/dashboard/mail?error=token_exchange_failed', baseUrl))
    }

    const tokens = await tokenResponse.json()
    console.log('📧 Tokens received successfully')

    // Get user's email from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })

    if (!userInfoResponse.ok) {
      console.error('📧 Failed to get user info')
      return NextResponse.redirect(new URL('/dashboard/mail?error=user_info_failed', baseUrl))
    }

    const googleUser = await userInfoResponse.json()
    console.log('📧 Google user email:', googleUser.email)

    // Save or update email account in tenant DB
    await TenantEmailAccount.findOneAndUpdate(
      { user: mailState.userId },
      {
        user: mailState.userId,
        email: googleUser.email,
        provider: 'gmail',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isConnected: true,
        lastSynced: new Date(),
        syncError: null
      },
      { upsert: true, new: true }
    )

    console.log('📧 Email account saved successfully for:', googleUser.email)

    // Redirect back to mail page with success
    return NextResponse.redirect(new URL('/dashboard/mail?connected=true', baseUrl))

  } catch (error) {
    console.error('📧 Mail OAuth callback error:', error)
    return NextResponse.redirect(new URL(`/dashboard/mail?error=${encodeURIComponent('Failed to connect email')}`, baseUrl))
  }
}
