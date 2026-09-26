'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { readTalioDevicePermissions, requestTalioDevicePermission } from '@/lib/talioDevicePermissions'

const labels = { desktopControl: 'MIRA — desktop task consent', microphone: 'Microphone — voice commands', screenRecording: 'Screen Recording — screen context', accessibility: 'Accessibility — desktop controls', camera: 'Camera — video meetings', location: 'Location — attendance & geofencing', notifications: 'Notifications — reminders & calls' }
export default function MiraPermissionChecklist() {
  const pathname = usePathname()
  const [permissions, setPermissions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh(kind) {
    if (!window.electronAPI?.miraPermissions) return
    try {
      setBusy(true)
      setError('')
      let nativeKind = kind
      if (['location', 'notifications', 'microphone', 'camera'].includes(kind)) {
        try { await requestTalioDevicePermission(kind); nativeKind = undefined }
        catch (error) { setError(error.message || 'Access was not granted. Check system settings.') }
      }
      const result = await window.electronAPI.miraPermissions(nativeKind)
      if (result.success) {
        const runtime = await readTalioDevicePermissions()
        const merged = { ...result.permissions }
        for (const [key, value] of Object.entries(runtime)) {
          if (merged[key] === 'runtime' || ['denied', 'prompt', 'default'].includes(value)) merged[key] = value
        }
        setPermissions(merged)
        if (result.message) setError(result.message)
      }
      else setError('Permission status could not be checked. Reopen Talio and try again.')
    } catch { setError('Unable to check permissions. Please try again.') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!pathname?.startsWith('/dashboard') || !window.electronAPI?.miraPermissions) return
    refresh()
    const check = () => { if (document.visibilityState === 'visible') refresh() }
    const timer = setInterval(check, 10000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [pathname])
  const missing = Object.keys(labels).filter(key => permissions && ['denied', 'restricted', 'not-determined', 'prompt', 'default', 'runtime'].includes(permissions[key]))
  if (!pathname?.startsWith('/dashboard')) return null
  if (!missing.length && !error) return null
  return <aside aria-label="Talio permissions required" className="fixed bottom-4 right-4 z-[100100] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-default-200 bg-content1 p-4 shadow-xl">
    <h2 className="font-semibold">Finish setting up Talio</h2>
    <p className="mt-1 text-xs text-default-500">Enable the features you use. OS-managed access must be checked in system settings; opening settings does not grant access. Focus/Do Not Disturb can silence notifications. macOS may need a restart after screen access changes.</p>
    <ul className="my-3 max-h-64 overflow-y-auto space-y-2">{missing.map(key => <li key={key} className="flex items-center justify-between gap-3 text-xs"><span>{labels[key]}<span className="block text-default-500">{permissions[key] === 'runtime' ? 'OS-managed / not verified' : permissions[key]}</span></span><button disabled={busy} className="shrink-0 rounded-lg bg-default-100 px-3 py-2 disabled:opacity-50" onClick={() => refresh(key)}>{permissions[key] === 'runtime' ? 'Check' : 'Allow'}</button></li>)}</ul>
    <div className="flex gap-3 text-xs mb-2">{['location', 'notifications'].map(key => <button key={key} disabled={busy} onClick={async () => { try { const result = await window.electronAPI.miraPermissions(key); if (result.message) setError(result.message) } catch { setError('Unable to open system settings.') } }}>{key === 'location' ? 'Location settings' : 'Notification settings'}</button>)}</div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <button disabled={busy} onClick={() => { setError(''); refresh() }} className="text-sm font-medium">{busy ? 'Checking…' : 'Recheck permissions'}</button>
  </aside>
}
