'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A tab may own one Document PiP window. Share it rather than closing an
// ongoing meeting when the user also pops out MIRA.
let nativeWindow = null
let openingWindow = null
const automaticSurfaces = new Set()
function registerAutomaticSurface(surface) {
  automaticSurfaces.add(surface)
  if (automaticSurfaces.size === 1) {
    try {
      navigator.mediaSession?.setActionHandler('enterpictureinpicture', () => {
        // Only the browser's eligible media-session callback grants automatic
        // PiP activation. A plain visibility event does not grant permission.
        if (document.visibilityState !== 'hidden') return
        automaticSurfaces.forEach(entry => entry.open(true))
      })
    } catch { /* Unsupported browsers keep the in-app PiP. */ }
  }
  return () => {
    automaticSurfaces.delete(surface)
    if (!automaticSurfaces.size) {
      try { navigator.mediaSession?.setActionHandler('enterpictureinpicture', null) } catch {}
    }
  }
}

function panelSize(host) {
  const panel = host?.querySelector('[data-meeting-pip], .mira-workspace') || host
  const rect = panel?.getBoundingClientRect()
  return { width: Math.ceil(rect?.width || 340), height: Math.ceil(rect?.height || 180) }
}

function fitWindow(target) {
  if (!target || target.closed) return
  const sizes = [...target.document.querySelectorAll('[data-native-pip-surface]')].map(panelSize)
  if (!sizes.length) return
  const width = Math.max(...sizes.map(size => size.width))
  const height = sizes.reduce((sum, size) => sum + size.height, 0)
  // Browser-owned title bars and minimum dimensions cannot be removed.
  const chromeWidth = Math.max(0, (target.outerWidth || width) - (target.innerWidth || width))
  const chromeHeight = Math.max(0, (target.outerHeight || height) - (target.innerHeight || height))
  if (Math.abs((target.innerWidth || 0) - width) > 1 || Math.abs((target.innerHeight || 0) - height) > 1) {
    try { target.resizeTo?.(width + chromeWidth, height + chromeHeight) } catch {}
  }
}

async function getPipWindow(size) {
  if (nativeWindow && !nativeWindow.closed) return nativeWindow
  if (openingWindow) return openingWindow
  const desktop = window.electronAPI?.nativePip === true
  if (!desktop && !window.documentPictureInPicture?.requestWindow) {
    throw new Error('Separate always-on-top windows are not supported in this browser. Use desktop Chrome or Edge. The in-app view is still available.')
  }
  openingWindow = desktop
    ? Promise.resolve(window.open('about:blank', 'talio-live-pip', `width=${size.width},height=${size.height}`))
    : window.documentPictureInPicture.requestWindow(size)
  try {
    const target = await openingWindow
    if (!target) throw new Error('Talio could not open the live window.')
    nativeWindow = target
    target.document.title = 'Talio · Live windows'
    const base = target.document.createElement('base')
    base.href = document.baseURI
    target.document.head.append(base)
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => target.document.head.append(node.cloneNode(true)))
    target.document.documentElement.className = document.documentElement.className
    target.document.body.className = document.body.className
    const theme = document.documentElement.getAttribute('data-theme')
    if (theme) target.document.documentElement.setAttribute('data-theme', theme)
    const style = target.document.createElement('style')
    style.textContent = `html,body{margin:0;padding:0}body{display:flex;flex-direction:column;gap:0;overflow:auto;background:#151518}
      [data-native-pip-surface]{position:relative;flex-shrink:0;width:100%;isolation:isolate}
      [data-native-pip-surface] [aria-label^="Pop out"]{display:none!important}
      [data-native-pip-surface] .mira-workspace{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;transform:none!important}
      [data-native-pip-surface] [data-meeting-pip]{position:relative!important;inset:auto!important;margin:0!important;width:100%!important}
      [data-native-pip-surface] [data-meeting-pip="expanded"]{height:var(--native-panel-height,416px)!important;max-height:none}
      [data-native-pip-surface] [data-meeting-pip="bubble"]{width:56px!important}`
    target.document.head.append(style)
    target.addEventListener('pagehide', () => { if (nativeWindow === target) nativeWindow = null }, { once: true })
    return target
  } finally {
    openingWindow = null
  }
}

const NativePipSurface = forwardRef(function NativePipSurface({ children, enabled = true, automatic = false }, ref) {
  const placeholder = useRef(null)
  const [host, setHost] = useState(null)
  const targetRef = useRef(null)
  const cleanupRef = useRef(null)
  const mounted = useRef(false)
  const enabledRef = useRef(enabled)
  const automaticRef = useRef(automatic)
  automaticRef.current = automatic
  enabledRef.current = enabled
  const [error, setError] = useState('')

  function restore({ focus = false } = {}) {
    const target = targetRef.current
    if (focus && target) {
      if (window.electronAPI?.activateMira) window.electronAPI.activateMira().catch(() => {})
      else window.focus()
    }
    cleanupRef.current?.()
    cleanupRef.current = null
    targetRef.current = null
    if (host && placeholder.current) placeholder.current.append(host)
    if (target && !target.closed && !target.document.querySelector('[data-native-pip-surface]')) target.close()
    else fitWindow(target)
  }

  useEffect(() => {
    mounted.current = true
    const element = document.createElement('div')
    element.dataset.nativePipSurface = ''
    placeholder.current.append(element)
    setHost(element)
    return () => {
      mounted.current = false
      cleanupRef.current?.()
      const target = targetRef.current
      element.remove()
      if (target && !target.closed && !target.document.querySelector('[data-native-pip-surface]')) target.close()
    }
  }, [])

  useEffect(() => { if (!enabled) restore() }, [enabled, host]) // Preserve the portal target and live media components.

  async function open(fromBrowser = false) {
      if (automaticRef.current && document.visibilityState !== 'hidden') return
      setError('')
      try {
        const size = panelSize(host)
        const target = await getPipWindow(size)
        if (!mounted.current || !enabledRef.current || !host || (automaticRef.current && document.visibilityState !== 'hidden')) {
          if (!target.document.querySelector('[data-native-pip-surface]')) target.close()
          return
        }
        cleanupRef.current?.()
        targetRef.current = target
        host.style.setProperty('--native-panel-height', `${size.height}px`)
        target.document.body.append(host)
        const onClose = () => {
          cleanupRef.current?.()
          cleanupRef.current = null
          targetRef.current = null
          placeholder.current?.append(host)
        }
        target.addEventListener('pagehide', onClose, { once: true })
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fitWindow(target))
        observer?.observe(host)
        fitWindow(target)
        cleanupRef.current = () => { observer?.disconnect(); target.removeEventListener('pagehide', onClose) }
      } catch (cause) {
        if (mounted.current && !fromBrowser) setError(cause?.message || 'Unable to open a separate window. Try the pop-out button again.')
      }
  }

  const controls = useRef({ open, restore })
  controls.current = { open, restore }
  useEffect(() => {
    if (!automatic || !enabled || !host) return
    const unregister = registerAutomaticSurface({ open: (...args) => controls.current.open(...args) })
    const returnWhenVisible = () => {
      if (document.visibilityState === 'visible') controls.current.restore()
      else if (window.electronAPI?.nativePip === true) controls.current.open(true)
    }
    document.addEventListener('visibilitychange', returnWhenVisible)
    window.addEventListener('focus', returnWhenVisible)
    return () => {
      unregister()
      document.removeEventListener('visibilitychange', returnWhenVisible)
      window.removeEventListener('focus', returnWhenVisible)
    }
  }, [automatic, enabled, host])

  useImperativeHandle(ref, () => ({ restore, open }))

  return <><div ref={placeholder} />{host && createPortal(<>{children}{error && <p role="alert" className="fixed bottom-3 left-3 z-[100000] max-w-sm rounded-xl bg-slate-900 p-3 text-sm text-white">{error}<button className="ml-2 underline" onClick={() => setError('')}>Dismiss</button></p>}</>, host)}</>
})

export default NativePipSurface
