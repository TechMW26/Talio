'use client'
export async function productivitySettingsRequest(enabled) {
  const response = await fetch('/api/settings/productivity', {
    method: enabled === undefined ? 'GET' : 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
    ...(enabled === undefined ? {} : { body: JSON.stringify({ screenshotsEnabled: enabled }) }),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.message || 'Unable to save settings')
  return result.data
}
