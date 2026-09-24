import { getMiraUiContext } from './miraUiAction'
let location = null

// Never prompt for location or start continuous tracking just to open chat.
export async function prepareMiraLocation() {
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' })
    if (permission?.state !== 'granted') { location = null; return }
    navigator.geolocation.getCurrentPosition(position => {
      location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: position.timestamp }
    }, () => { location = null }, { maximumAge: 60000, timeout: 5000, enableHighAccuracy: false })
  } catch { location = null }
}

export function getMiraClientContext() {
  return { page: window.location.pathname, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, language: navigator.language, desktopScreenAvailable: typeof window.electronAPI?.captureMiraDesktopScreen === 'function',
    ui: getMiraUiContext(), location: location && Date.now() - location.capturedAt < 300000 ? location : null }
}

export function sanitizeMiraClientContext(value) {
  const result = { page: '/dashboard', location: null }
  if (!value || typeof value !== 'object') return result
  result.desktopScreenAvailable = value.desktopScreenAvailable === true
  if (Array.isArray(value.ui?.controls)) result.ui = { dialog: value.ui.dialog === true, controls: value.ui.controls.slice(0, 70).filter(c => c && typeof c.id === 'string' && /^ui-\d+$/.test(c.id) && typeof c.label === 'string').map(c => ({ id: c.id.slice(0, 30), label: c.label.slice(0, 100), role: String(c.role || '').slice(0, 20), region: String(c.region || '').slice(0, 20), executable: c.executable === true, disabled: c.disabled === true })) }
  if (typeof value.page === 'string' && /^\/dashboard(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value.page) && value.page.length < 200) result.page = value.page
  if (typeof value.timezone === 'string' && value.timezone.length < 80) {
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); result.timezone = value.timezone } catch { /* Invalid hint. */ }
  }
  const point = value.location
  if (point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
      Number.isFinite(point.capturedAt) && Date.now() - point.capturedAt >= -30000 && Date.now() - point.capturedAt < 300000) {
    result.location = { latitude: point.latitude, longitude: point.longitude, capturedAt: point.capturedAt, source: 'client-reported location, not verified attendance evidence' }
  }
  return result
}
