/**
 * IP-based Geolocation Utility
 * 
 * Provides approximate location from IP address when GPS is unavailable.
 * Uses ip-api.com (primary, free, no key required) with ipapi.co fallback.
 * 
 * NOTE: IP geolocation is approximate (city-level accuracy, typically 1-50km).
 * It should only be used as a fallback when GPS/device location is unavailable.
 */

/**
 * Get location from IP using ip-api.com (primary)
 * Free tier: 45 requests/minute, no API key needed
 * 
 * @param {string} ipAddress - The IP address to geolocate
 * @returns {Promise<{success: boolean, latitude?: number, longitude?: number, accuracy?: string, city?: string, region?: string, country?: string, error?: string}>}
 */
async function getLocationFromIpApi(ipAddress) {
  try {
    // ip-api.com only supports HTTP on free tier
    const cleanIp = (ipAddress && ipAddress !== 'unknown' && ipAddress !== '::1' && ipAddress !== '127.0.0.1')
      ? ipAddress
      : '' // Empty string = auto-detect from request

    const url = cleanIp
      ? `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,message,lat,lon,city,regionName,country,query`
      : `http://ip-api.com/json/?fields=status,message,lat,lon,city,regionName,country,query`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    if (data.status !== 'success') {
      return { success: false, error: data.message || 'IP geolocation failed' }
    }

    return {
      success: true,
      latitude: data.lat,
      longitude: data.lon,
      city: data.city,
      region: data.regionName,
      country: data.country,
      ip: data.query,
      source: 'ip-api.com'
    }
  } catch (error) {
    console.error('[IP Geolocation] ip-api.com error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Get location from IP using ipapi.co (fallback)
 * Free tier: 1000 requests/day, no API key needed
 * 
 * @param {string} ipAddress - The IP address to geolocate
 * @returns {Promise<{success: boolean, latitude?: number, longitude?: number, city?: string, region?: string, country?: string, error?: string}>}
 */
async function getLocationFromIpapiCo(ipAddress) {
  try {
    const cleanIp = (ipAddress && ipAddress !== 'unknown' && ipAddress !== '::1' && ipAddress !== '127.0.0.1')
      ? ipAddress
      : ''

    const url = cleanIp
      ? `https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`
      : `https://ipapi.co/json/`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Talio-HRMS/1.0'
      }
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    if (data.error) {
      return { success: false, error: data.reason || 'IP geolocation failed' }
    }

    if (!data.latitude || !data.longitude) {
      return { success: false, error: 'No coordinates returned' }
    }

    return {
      success: true,
      latitude: data.latitude,
      longitude: data.longitude,
      city: data.city,
      region: data.region,
      country: data.country_name,
      ip: data.ip,
      source: 'ipapi.co'
    }
  } catch (error) {
    console.error('[IP Geolocation] ipapi.co error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Get approximate location from an IP address.
 * Tries ip-api.com first, falls back to ipapi.co.
 * 
 * @param {string} ipAddress - The client IP address
 * @returns {Promise<{success: boolean, latitude?: number, longitude?: number, city?: string, region?: string, country?: string, source?: string, ip?: string, error?: string}>}
 */
export async function getLocationFromIP(ipAddress) {
  console.log(`[IP Geolocation] Attempting IP-based location for: ${ipAddress || 'auto-detect'}`)

  // Try primary service
  const primary = await getLocationFromIpApi(ipAddress)
  if (primary.success) {
    console.log(`✅ [IP Geolocation] Resolved via ip-api.com: ${primary.city}, ${primary.region}, ${primary.country} (${primary.latitude}, ${primary.longitude})`)
    return primary
  }

  // Fallback
  console.log('[IP Geolocation] ip-api.com failed, trying ipapi.co fallback')
  const fallback = await getLocationFromIpapiCo(ipAddress)
  if (fallback.success) {
    console.log(`✅ [IP Geolocation] Resolved via ipapi.co: ${fallback.city}, ${fallback.region}, ${fallback.country} (${fallback.latitude}, ${fallback.longitude})`)
    return fallback
  }

  console.warn('[IP Geolocation] All IP geolocation services failed')
  return { success: false, error: 'All IP geolocation services unavailable' }
}

/**
 * Extract client IP from a Next.js request object.
 * Handles proxies (x-forwarded-for) and direct connections.
 * 
 * @param {Request} request - Next.js request object
 * @returns {string} The client IP address
 */
export function getClientIP(request) {
  // x-forwarded-for may contain multiple IPs, first one is the client
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim()
    if (firstIp && firstIp !== '::1' && firstIp !== '127.0.0.1') {
      return firstIp
    }
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp && realIp !== '::1' && realIp !== '127.0.0.1') {
    return realIp
  }

  return 'unknown'
}

export default {
  getLocationFromIP,
  getClientIP
}
