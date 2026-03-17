import { NextResponse } from 'next/server'
import { getLocationFromIP, getClientIP } from '@/lib/ipGeolocation'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET /api/attendance/ip-location
 * 
 * Returns approximate location based on the client's IP address.
 * Used as a fallback when GPS/device geolocation is unavailable.
 * Requires authentication.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [])

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 })
    }

    const clientIP = getClientIP(request)
    const result = await getLocationFromIP(clientIP)

    if (!result.success) {
      return NextResponse.json({
        success: false,
        message: 'Could not determine location from IP',
        error: result.error
      }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      latitude: result.latitude,
      longitude: result.longitude,
      city: result.city,
      region: result.region,
      country: result.country,
      source: 'ip-geolocation',
      provider: result.source,
      accuracy: 'approximate'
    })
  } catch (error) {
    console.error('[IP Location API] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to get IP-based location'
    }, { status: 500 })
  }
}
