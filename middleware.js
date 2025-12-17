import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

export async function middleware(request) {
  const token = request.headers.get('authorization')?.split(' ')[1] ||
                request.cookies.get('token')?.value

  // Public routes that don't require authentication
  const publicRoutes = ['/', '/login', '/register', '/forgot-password']
  const publicApiRoutes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/session',
    '/api/auth/forgot-password',
    '/api/auth/google/callback',
    '/api/assetlinks'
  ]

  // Routes allowed during forced password change
  const passwordChangeRoutes = ['/auth/change-password']
  const passwordChangeApiRoutes = [
    '/api/auth/change-password',
    '/api/auth/validate'
  ]

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
      const secret = new TextEncoder().encode(process.env.JWT_SECRET)
      const { payload } = await jwtVerify(token, secret)

      // For API routes, we can't easily check forcePasswordChange without DB access
      // The frontend will handle the redirect, and individual API routes should check if needed
      // However, we add a header to indicate we should check password change
      const response = NextResponse.next()
      response.headers.set('x-user-id', payload.userId)
      return response
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid token' },
        { status: 401 }
      )
    }
  }

  // For page routes, redirect to login if no token
  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // For authenticated page routes (like dashboard), verify token
  if (token && request.nextUrl.pathname.startsWith('/dashboard')) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET)
      await jwtVerify(token, secret)
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
  matcher: ['/dashboard/:path*', '/api/:path*', '/auth/:path*'],
}

