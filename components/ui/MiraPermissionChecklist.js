'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

const labels = { desktopControl: 'MIRA — desktop task consent', microphone: 'Microphone — voice commands', screenRecording: 'Screen Recording — screen context', accessibility: 'Accessibility — desktop controls', camera: 'Camera — video meetings' }
export default function MiraPermissionChecklist() {
  const pathname = usePathname()
  const [permissions, setPermissions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh(kind) {
    if (!window.electronAPI?.miraPermissions) return
    try {
      setBusy(true)
      const result = await window.electronAPI.miraPermissions(kind)
      if (result.success) setPermissions(result.permissions)
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
  const missing = Object.keys(labels).filter(key => permissions && ['denied', 'restricted', 'not-determined'].includes(permissions[key]))
  if (!pathname?.startsWith('/dashboard')) return null
  if (!missing.length && !error) return null
  return <aside aria-label="Talio permissions required" className="fixed bottom-4 right-4 z-[100100] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-default-200 bg-content1 p-4 shadow-xl">
    <h2 className="font-semibold">Finish setting up Talio</h2>
    <p className="mt-1 text-xs text-default-500">These features need your permission. This checklist stays until access is enabled. macOS may require restarting Talio after Screen Recording is allowed.</p>
    <ul className="my-3 space-y-2">{missing.map(key => <li key={key} className="flex items-center justify-between gap-3 text-xs"><span>{labels[key]}</span><button disabled={busy} className="shrink-0 rounded-lg bg-default-100 px-3 py-2 disabled:opacity-50" onClick={() => refresh(key)}>Allow</button></li>)}</ul>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <button disabled={busy} onClick={() => { setError(''); refresh() }} className="text-sm font-medium">{busy ? 'Checking…' : 'Recheck permissions'}</button>
  </aside>
}
