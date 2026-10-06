'use client'

import { FaCheckCircle, FaExclamationTriangle, FaMapMarkerAlt, FaRedo } from 'react-icons/fa'

export default function LocationAccessStatus({
  geofence,
  permissionStatus,
  location,
  error,
  loading,
  onRetry,
  compact = false,
  showLocation = false,
}) {
  const coordinate = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null
  const latitude = coordinate(location?.latitude)
  const longitude = coordinate(location?.longitude)
  const address = typeof location?.address === 'string' ? location.address.trim() : ''
  const coordinates = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : ''
  const locationText = showLocation ? address || coordinates : ''
  if (!geofence?.enabled) {
    if (!locationText) return null
    return <div className={`flex items-center gap-2 rounded-xl border border-default-200 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
      <FaMapMarkerAlt className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words"><span className="font-semibold">Fetched location: </span>{locationText}</span>
    </div>
  }

  const denied = permissionStatus === 'denied' || permissionStatus === 'unsupported'
  const ready = permissionStatus === 'granted' && location
  const maxAccuracy = Number(geofence.maxAccuracyMeters) || 150
  const accurate = ready && (!Number.isFinite(Number(location.accuracy)) || Number(location.accuracy) <= maxAccuracy)

  const tone = denied || error || (ready && !accurate)
    ? 'border-danger-300 bg-danger-50 text-danger-700 dark:bg-danger-950/30'
    : accurate
      ? 'border-success-300 bg-success-50 text-success-700 dark:bg-success-950/30'
      : 'border-primary-300 bg-primary-50 text-primary-700 dark:bg-primary-950/30'

  const message = denied
    ? 'Location access is blocked. Enable it in browser/site settings, then retry.'
    : error
      ? error
      : accurate
        ? `Location ready (${Math.round(location.accuracy || 0)}m accuracy).`
        : ready
          ? `Improve GPS accuracy to ${maxAccuracy}m or better before marking attendance.`
          : geofence.strictMode
            ? 'Precise location is required for check-in and check-out.'
            : 'Location will be captured when you mark attendance.'

  const Icon = accurate ? FaCheckCircle : denied || error || (ready && !accurate) ? FaExclamationTriangle : FaMapMarkerAlt

  return (
    <div className={`flex items-center gap-2 rounded-xl border ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'} ${tone}`} role="status">
      <Icon className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{message}{locationText && <span className="mt-1 block"><span className="font-semibold">Fetched location: </span>{locationText}</span>}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-black/5 disabled:opacity-50"
      >
        <FaRedo className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        {loading ? 'Locating' : 'Retry'}
      </button>
    </div>
  )
}
