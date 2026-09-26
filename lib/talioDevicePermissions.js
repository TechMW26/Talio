// Runtime checks never retain location coordinates, recordings, or camera frames.
export async function readTalioDevicePermissions() {
  const result = {}
  for (const [key, name] of [['location', 'geolocation'], ['microphone', 'microphone'], ['camera', 'camera']]) {
    try { result[key] = (await navigator.permissions.query({ name })).state } catch { result[key] = 'runtime' }
  }
  result.notifications = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  return result
}

export async function requestTalioDevicePermission(kind) {
  if (kind === 'location') {
    if (!navigator.geolocation) throw new Error('Location is unavailable on this device.')
    await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(() => resolve(), error => reject(new Error(error.code === 1 ? 'Location access is blocked. Enable it in system settings.' : 'Location could not be determined. Check Location Services and your connection.')), { timeout: 10000, maximumAge: 0, enableHighAccuracy: false }))
  } else if (kind === 'notifications') {
    if (typeof Notification === 'undefined') throw new Error('Notifications are unavailable on this device.')
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Enable Talio in system notification settings.')
    // Permission is browser-level; delivery can still be muted by the OS.
    const test = new Notification('Talio permission test', { body: 'Notifications are enabled if you can see this message.' })
    setTimeout(() => test.close(), 5000)
  } else if (kind === 'microphone' || kind === 'camera') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: kind === 'microphone', video: kind === 'camera' })
    stream.getTracks().forEach(track => track.stop())
  }
}
