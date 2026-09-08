export const SCREEN_CAPTURE_PROTECTED_ROLES = Object.freeze(['admin', 'hr'])

export function normalizeRole(role) {
  return String(role || '').trim().toLowerCase()
}
export function isScreenCaptureProtectedRole(role) {
  return SCREEN_CAPTURE_PROTECTED_ROLES.includes(normalizeRole(role))
}
