'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { readTalioDevicePermissions, requestTalioDevicePermission } from '@/lib/talioDevicePermissions'

export const REQUIRED_DESKTOP_PERMISSIONS = ['camera', 'microphone', 'location', 'screenRecording']
const labels = { camera: 'Camera — video meetings', microphone: 'Microphone — meetings and voice', location: 'Location — attendance and geofencing', screenRecording: 'Screen capture — work activity and screen assistance' }
export const hasRequiredDesktopPermissions = value => REQUIRED_DESKTOP_PERMISSIONS.every(key => value?.[key] === 'granted')

export default function DesktopPermissionGate({ children }) {
  const pathname = usePathname()
  const [desktop, setDesktop] = useState(null)
  const [permissions, setPermissions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const verified = useRef({})
  const running = useRef(false)
  const active = pathname?.startsWith('/dashboard')
  async function check(kind) {
    if (running.current || !window.electronAPI?.miraPermissions) return
    running.current = true; setBusy(true); setError('')
    try {
      let native = await window.electronAPI.miraPermissions()
      if (!native.success) throw new Error('Unable to check required device permissions. Retry to continue.')
      if (kind === 'screenRecording' || (['camera', 'microphone'].includes(kind) && native.permissions.platform === 'darwin')) {
        native = await window.electronAPI.miraPermissions(kind)
        if (!native.success) throw new Error('The permission request failed. Please retry.')
        if (native.message) setError(native.message)
      } else if (kind) {
        delete verified.current[kind]
        await requestTalioDevicePermission(kind)
        verified.current[kind] = true
      }
      const runtime = await readTalioDevicePermissions()
      const merged = { ...native.permissions }
      for (const key of ['camera', 'microphone', 'location']) {
        // OS denial wins. A browser "granted" value alone does not prove that
        // location works, since Electron's site permission can be auto-allowed.
        if (['denied', 'restricted', 'not-determined'].includes(merged[key])) continue
        if (runtime[key] === 'denied') { merged[key] = 'denied'; delete verified.current[key] }
        else if (merged[key] !== 'granted') merged[key] = verified.current[key] ? 'granted' : runtime[key] === 'granted' ? 'runtime' : runtime[key]
      }
      setPermissions(merged)
    } catch (err) {
      if (kind) setPermissions(previous => ({ ...previous, [kind]: 'denied' }))
      setError(err.message || 'Permission check failed. Please retry.')
    } finally { running.current = false; setBusy(false) }
  }
  useEffect(() => {
    const enabled = Boolean(window.electronAPI?.miraPermissions)
    setDesktop(enabled)
    if (!enabled || !active) return
    check()
    const refresh = () => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 10000)
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer) }
  }, [active])
  if (!active || desktop === false) return children
  if (desktop && hasRequiredDesktopPermissions(permissions)) return children
  return <main className="fixed inset-0 z-[100200] overflow-y-auto bg-background text-foreground flex items-center justify-center p-6" aria-label="Required desktop permissions">
    <section className="w-full max-w-lg rounded-2xl border border-default-200 bg-content1 p-6 shadow-xl">
      <h1 className="text-xl font-semibold">Set up Talio permissions</h1>
      <p className="mt-2 text-sm text-default-500">These four permissions are required to use the desktop app. Allow access in each system prompt. If you deny access, setup stays open; you can retry or close Talio.</p>
      <ul className="my-5 space-y-4">{REQUIRED_DESKTOP_PERMISSIONS.map(key => <li key={key} className="flex items-center justify-between gap-4 text-sm">
        <span>{labels[key]}<span className="block text-xs text-default-500">{permissions?.[key] === 'granted' ? 'Allowed' : permissions?.[key] || 'Checking…'}</span></span>
        {permissions?.[key] !== 'granted' && <div className="flex shrink-0 flex-col gap-1">
          <button disabled={busy || !desktop} onClick={() => check(key)} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">Allow</button>
          <button disabled={busy || !desktop} onClick={async () => { try { const result = await window.electronAPI.miraPermissions(`${key}:settings`); if (result.message) setError(result.message) } catch { setError('Could not open system settings.') } }} className="text-xs text-default-500">Open settings</button>
        </div>}
      </li>)}</ul>
      <p className="text-xs text-default-500">macOS may require System Settings and a restart for screen recording or previously denied access. No screen image, recording, or location is saved by these setup checks.</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <button disabled={busy} onClick={() => check()} className="mt-4 text-sm font-medium">{busy ? 'Checking…' : 'Recheck access'}</button>
    </section>
  </main>
}
