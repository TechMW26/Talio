export async function miraSettingsRequest(path, payload) {
  const response = await fetch(path, { method: payload ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}) })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.message || 'Could not update Mira settings')
  return body
}

export async function saveMiraAccess(settings) {
  const response = await fetch('/api/mira/access', { method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: settings.enabled, allowedLevels: settings.allowedLevels }) })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.message || 'Could not save Mira access')
  window.dispatchEvent(new CustomEvent('mira:access-changed'))
  return body
}
