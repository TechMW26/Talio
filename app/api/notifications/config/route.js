import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import fs from 'fs'
import path from 'path'

// GET - Check if API key is configured and get current config
// Non-admins can check if configured (but can't see the actual keys)
// Only admins can see the masked keys
// Public route (no auth required) returns Firebase config for client-side initialization
export async function GET(request) {
  try {
    // Check if requesting public Firebase config (for service worker/client)
    const url = new URL(request.url)
    const publicConfig = url.searchParams.get('public') === 'true'

    // Firebase client config (public - safe to expose)
    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || ''
    }

    // For public requests (service workers, client initialization), return config directly
    if (publicConfig) {
      const cacheKey = buildCacheKey({
        tenantId: 'public',
        role: 'public',
        userId: 'public',
        namespace: 'notifications-config',
        params: { public: true }
      })
      const cached = await getCache(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }

      const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId)
      const response = {
        success: true,
        configured,
        config: firebaseConfig
      }

      await setCache(cacheKey, response, 30 * 60)

      return NextResponse.json(response)
    }

    // For authenticated requests, check auth and return detailed info
    const authHeader = request.headers.get('authorization')

    // If no auth header but not public request, still return basic config
    // This allows the web push registration to work without strict auth
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const cacheKey = buildCacheKey({
        tenantId: 'public',
        role: 'public',
        userId: 'public',
        namespace: 'notifications-config',
        params: { public: false }
      })
      const cached = await getCache(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }

      const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId)
      const response = {
        success: true,
        configured,
        config: firebaseConfig
      }

      await setCache(cacheKey, response, 30 * 60)

      return NextResponse.json(response)
    }

    // Get authenticated user using getAuthAndModels
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    const { user, tenant } = auth

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName || 'public',
      role: user.role,
      userId: user._id || user.userId || 'public',
      namespace: 'notifications-config',
      params: { admin: user.role === 'admin' }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Check if Firebase is configured (server-side keys)
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
    const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    const firebaseVapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY

    const configured = !!(
      firebaseProjectId &&
      firebaseClientEmail &&
      firebasePrivateKey &&
      firebaseApiKey &&
      firebaseVapidKey &&
      firebaseProjectId !== 'YOUR_PROJECT_ID' &&
      firebasePrivateKey.includes('BEGIN PRIVATE KEY')
    )

    // Only admins can see the masked Firebase server config
    if (user.role === 'admin') {
      const maskedPrivateKey = firebasePrivateKey && firebasePrivateKey.includes('BEGIN PRIVATE KEY')
        ? '***CONFIGURED***'
        : ''

      const response = {
        success: true,
        configured,
        config: {
          // Client config (full)
          ...firebaseConfig,
          // Server config (masked for admin)
          serverProjectId: firebaseProjectId || '',
          clientEmail: firebaseClientEmail || '',
          privateKey: maskedPrivateKey
        }
      }

      await setCache(cacheKey, response, 30 * 60)

      return NextResponse.json(response)
    } else {
      const response = {
        success: true,
        configured,
        config: firebaseConfig
      }

      await setCache(cacheKey, response, 30 * 60)

      return NextResponse.json(response)
    }
  } catch (error) {
    console.error('Get config error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get configuration' },
      { status: 500 }
    )
  }
}

// POST - Firebase configuration is managed via .env file
// This endpoint is kept for compatibility but returns info message
export async function POST(request) {
  try {
    // Get authenticated user using getAuthAndModels
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }
    const { user } = auth

    // Only admin can access configuration
    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, message: 'Only administrators can access configuration' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Firebase is configured via environment variables in .env file. No UI configuration needed.',
      configured: true
    })
  } catch (error) {
    console.error('Config endpoint error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to access configuration' },
      { status: 500 }
    )
  }
}

