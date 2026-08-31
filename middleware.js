import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const TOKEN_CACHE = global.__tokenCache || new Map()
const TOKEN_CACHE_TTL = 5 * 60 * 1000
const TOKEN_CACHE_MAX_SIZE = 500 // Prevent unbounded memory growth
const VERIFIED_HEADER_NAMES = [
  'x-user-id',
  'x-verified-user-id',
  'x-verified-database',
  'x-verified-email',
  'x-verified-company-slug',
  'x-verified-company-name',
  'x-verified-role',
]

if (!global.__tokenCache) {
  global.__tokenCache = TOKEN_CACHE
}

// Cache the encoded JWT secret globally - avoids re-encoding on every request
let _cachedJwtSecret = null
function getJwtSecret() {
  if (!_cachedJwtSecret) {
    _cachedJwtSecret = new TextEncoder().encode(process.env.JWT_SECRET)
  }
  return _cachedJwtSecret
}

function getCachedPayload(token) {
  const cached = TOKEN_CACHE.get(token)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    TOKEN_CACHE.delete(token)
    return null
  }
  return cached.payload
}

function setCachedPayload(token, payload) {
  // Evict oldest entries if cache is too large
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX_SIZE) {
    const firstKey = TOKEN_CACHE.keys().next().value
    TOKEN_CACHE.delete(firstKey)
  }
  TOKEN_CACHE.set(token, {
    payload,
    expiresAt: Date.now() + TOKEN_CACHE_TTL
  })
}

export async function middleware(request) {
  // Permanent redirect: app.talio.in/resources -> talio.in/resources
  if (request.nextUrl.pathname.startsWith('/resources')) {
    const redirectUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, 'https://talio.in')
    return NextResponse.redirect(redirectUrl, { status: 301 })
  }

  // SuperAdmin routes - handle separately (uses superadmin_token on client side)
  // SuperAdmin auth is handled by the API routes themselves using superadminAuth.js
  if (request.nextUrl.pathname.startsWith('/superadmin')) {
    // Allow superadmin pages - they handle their own auth via localStorage
    return NextResponse.next()
  }

  // SuperAdmin API routes - use their own auth mechanism
  if (request.nextUrl.pathname.startsWith('/api/superadmin')) {
    return NextResponse.next()
  }

  const token = request.headers.get('authorization')?.split(' ')[1] ||
    request.cookies.get('token')?.value

  // Public routes that don't require authentication
  const publicRoutes = ['/', '/login', '/register', '/forgot-password', '/auth/forgot-password', '/auth/reset-password', '/setup', '/join', '/download']
  const publicApiRoutes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/session',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/google/callback',
    '/api/recruitment/linkedin/callback',
    '/api/recruitment/webhooks/linkedin',
    '/api/assetlinks',
    '/api/meetings/guest/', // Guest meeting access (public)
    '/api/attendance-machines/ingest/', // Machine webhooks authenticate with a per-device token
    '/api/setup/check',
    '/api/setup/create-admin',
    '/api/setup/tenant', // Tenant setup with setup code
    '/api/images/', // GridFS image serving (loaded by img tags)
    '/api/latest-release', // Public metadata for latest downloadable release
    '/api/cron/', // Cron routes use CRON_SECRET for auth
    '/api/notifications/config', // Firebase config for service worker (public=true)
    '/api/health', // Health check endpoint (load balancers, monitoring)
    '/api/redis-status', // Redis connectivity status (operational)
    '/api/desktop/min-version', // Desktop app minimum version check (unauthenticated)
  ]

  // Routes allowed during forced password change
  const passwordChangeRoutes = ['/auth/change-password']
  const passwordChangeApiRoutes = [
    '/api/auth/change-password',
    '/api/auth/validate'
  ]

  // Socket.IO handles its own authentication via the handshake `auth` option.
  // Exclude it from middleware token checks so polling/upgrade requests are not blocked.
  if (request.nextUrl.pathname.startsWith('/api/socketio')) {
    return NextResponse.next()
  }

  const isPublicRoute = publicRoutes.some(route =>
    route === '/' ? request.nextUrl.pathname === '/' : request.nextUrl.pathname.startsWith(route)
  )
  const isPublicApiRoute = publicApiRoutes.some(route => request.nextUrl.pathname.startsWith(route))
  const isPasswordChangeRoute = passwordChangeRoutes.some(route => request.nextUrl.pathname.startsWith(route))
  const isPasswordChangeApiRoute = passwordChangeApiRoutes.some(route => request.nextUrl.pathname.startsWith(route))

  if (isPublicRoute || isPublicApiRoute) {
    return NextResponse.next()
  }

  // Allow password change routes without additional checks
  if (isPasswordChangeRoute || isPasswordChangeApiRoute) {
    // Still need to verify token exists for password change routes
    if (!token && isPasswordChangeRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Check if accessing API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!token) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }

    try {
      const cachedPayload = getCachedPayload(token)
      const payload = cachedPayload || (await jwtVerify(token, getJwtSecret())).payload
      if (!cachedPayload) {
        setCachedPayload(token, payload)
      }

      // Forward only server-verified identity data to route handlers. These must
      // be request headers (not response headers), and any client-supplied values
      // must be removed first to prevent cross-tenant header spoofing.
      const requestHeaders = new Headers(request.headers)
      VERIFIED_HEADER_NAMES.forEach((name) => requestHeaders.delete(name))

      if (payload.userId) {
        requestHeaders.set('x-user-id', String(payload.userId))
        requestHeaders.set('x-verified-user-id', String(payload.userId))
      }
      if (payload.databaseName) requestHeaders.set('x-verified-database', String(payload.databaseName))
      if (payload.email) requestHeaders.set('x-verified-email', String(payload.email))
      if (payload.companySlug) requestHeaders.set('x-verified-company-slug', String(payload.companySlug))
      if (payload.companyName) requestHeaders.set('x-verified-company-name', String(payload.companyName))
      if (payload.role) requestHeaders.set('x-verified-role', String(payload.role))

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid token' },
        { status: 401 }
      )
    }
  }

  // For page routes, redirect to login if no token
  // BUT: Allow /dashboard through without token check - dashboard handles its own auth
  // This prevents redirect loops when cookies aren't working properly (e.g., VS Code Simple Browser)
  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    // Check for special bypass param (set by login page when redirecting)
    const bypassAuth = request.nextUrl.searchParams.get('_auth') === 'local'
    if (bypassAuth) {
      // Allow through - dashboard will verify localStorage auth
      console.log('[Middleware] Allowing dashboard access with _auth=local bypass')
      return NextResponse.next()
    }

    return NextResponse.redirect(new URL('/login', request.url))
  }

  // For authenticated page routes (like dashboard), verify token
  if (token && request.nextUrl.pathname.startsWith('/dashboard')) {
    try {
      const cachedPayload = getCachedPayload(token)
      if (!cachedPayload) {
        const { payload } = await jwtVerify(token, getJwtSecret())
        setCachedPayload(token, payload)
      }
      // Token is valid - the frontend will handle forcePasswordChange redirect
      // since middleware can't access the database
    } catch (error) {
      // Invalid token, redirect to login
      const response = NextResponse.redirect(new URL('/login', request.url))
      // Clear the invalid token cookie
      response.cookies.delete('token')
      return response
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/auth/:path*', '/resources/:path*', '/superadmin/:path*', '/setup/:path*'],
}

