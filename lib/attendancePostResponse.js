import { after } from 'next/server'
import { reverseGeocode } from '@/lib/geocoding'

// Keep best-effort integrations alive on Vercel without delaying a saved punch.
export function afterAttendanceResponse(task) {
  after(async () => {
    try {
      await task()
    } catch (error) {
      console.error('[Attendance] Follow-up failed:', error)
    }
  })
}

export async function enrichAttendanceAddress({ database, attendanceId, field, capturedAt, latitude, longitude, approximate }) {
  const result = await reverseGeocode(latitude, longitude)
  if (!result.success) return
  // Never save a stale document or overwrite a subsequent corrected location.
  await database.mutate('attendances', attendanceId, current => {
    const location = current.location?.[field]
    if (!location || +new Date(location.capturedAt) !== +new Date(capturedAt) || location.latitude !== latitude || location.longitude !== longitude) return current
    return { ...current, location: { ...current.location, [field]: { ...location,
      address: `${result.address}${approximate ? ' (approx.)' : ''}`,
      addressDetails: result.details ? { city: result.details.city, state: result.details.state, country: result.details.country, pincode: result.details.pincode, fullAddress: result.details.fullAddress } : null,
    } } }
  })
}
