import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const TOKEN_CACHE = global.__tokenCache || new Map()
const TOKEN_CACHE_TTL = 5 * 60 * 1000
const TOKEN_CACHE_MAX_SIZE = 500 // Prevent unbounded memory growth

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
    '/api/assetlinks',
    '/api/meetings/guest/', // Guest meeting access (public)
    '/api/setup/check',
    '/api/setup/create-admin',
    '/api/setup/tenant', // Tenant setup with setup code
    '/api/test-imagekit', // Test route for ImageKit debugging
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

      // For API routes, we can't easily check forcePasswordChange without DB access
      // The frontend will handle the redirect, and individual API routes should check if needed
      // However, we add a header to indicate we should check password change
      const response = NextResponse.next()
      response.headers.set('x-user-id', payload.userId)
      // Pass verified payload data as headers so auth.js can skip re-verification
      if (payload.userId) response.headers.set('x-verified-user-id', payload.userId)
      if (payload.databaseName) response.headers.set('x-verified-database', payload.databaseName)
      if (payload.email) response.headers.set('x-verified-email', payload.email)
      if (payload.companySlug) response.headers.set('x-verified-company-slug', payload.companySlug)
      if (payload.companyName) response.headers.set('x-verified-company-name', payload.companyName)
      if (payload.role) response.headers.set('x-verified-role', payload.role)
      return response
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

