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

export async function enrichAttendanceAddress({ Attendance, attendanceId, field, capturedAt, latitude, longitude, approximate }) {
  const result = await reverseGeocode(latitude, longitude)
  if (!result.success) return
  const prefix = `location.${field}`
  // Never save a stale document or overwrite a subsequent corrected location.
  await Attendance.updateOne({
    _id: attendanceId,
    [`${prefix}.capturedAt`]: capturedAt,
    [`${prefix}.latitude`]: latitude,
    [`${prefix}.longitude`]: longitude,
  }, { $set: {
    [`${prefix}.address`]: `${result.address}${approximate ? ' (approx.)' : ''}`,
    [`${prefix}.addressDetails`]: result.details ? {
      city: result.details.city, state: result.details.state, country: result.details.country,
      pincode: result.details.pincode, fullAddress: result.details.fullAddress,
    } : null,
  } })
}
