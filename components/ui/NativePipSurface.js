'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readMiraWindowRadius } from '@/hooks/useMiraWindowRadius'
import { miraFloatingSize, MIRA_FACE_PADDING } from '@/lib/miraFloatingLayout'

// A tab may own one Document PiP window. Share it rather than closing an
// ongoing meeting when the user also pops out MIRA.
let nativeWindow = null
let openingWindow = null
export function getMiraNativePipMode() {
  if (!nativeWindow || nativeWindow.closed || !nativeWindow.document.querySelector('.mira-workspace')) return 'in-app'
  return window.electronAPI?.nativePip === true ? 'desktop-pip' : 'browser-pip'
}
function isAppAway() {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}
const automaticSurfaces = new Set()
function registerAutomaticSurface(surface) {
  automaticSurfaces.add(surface)
  if (automaticSurfaces.size === 1) {
    try {
      navigator.mediaSession?.setActionHandler('enterpictureinpicture', () => {
        // Only the browser's eligible media-session callback grants automatic
        // PiP activation. A plain visibility event does not grant permission.
        if (!isAppAway()) return
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
  const mode = panel?.getAttribute('data-meeting-pip')
  if (mode && host.ownerDocument !== document) {
    // Never feed the child viewport's responsive dimensions back into resizeTo.
    // Keep the actual inline dimensions, or use the equivalent inline mode size
    // when the user expands/minimises the meeting while it is outside the app.
    const defaults = { expanded: { width: 512, height: 416 }, compact: { width: 352, height: 84 }, bubble: { width: 56, height: 56 } }
    const size = host.dataset.meetingMode === mode
      ? { width: Number(host.dataset.meetingWidth), height: Number(host.dataset.meetingHeight) }
      : defaults[mode] || defaults.expanded
    host.style.setProperty('--native-panel-width', `${size.width}px`)
    host.style.setProperty('--native-panel-height', `${size.height}px`)
    return size
  }
  if (panel?.matches('.mira-workspace')) {
    if (panel.dataset.miraFaceOnly === 'true') {
      const size = miraFloatingSize(panel.dataset.miraDetails === 'true')
      if (host.ownerDocument !== document) {
        panel.style.setProperty('--mira-float-width', `${size.width}px`)
        panel.style.setProperty('--mira-float-height', `${size.height}px`)
      }
      return size
    }
    const width = Math.min(400, host.ownerDocument.defaultView?.innerWidth || 400)
    return { width, height: Math.max(180, Math.ceil(panel.offsetHeight || panel.getBoundingClientRect().height || 0)) }
  }
  const rect = panel?.getBoundingClientRect()
  // Layout dimensions exclude the panel's entrance/exit transform.
  return { width: Math.ceil(panel?.offsetWidth || rect?.width || 340), height: Math.ceil(panel?.offsetHeight || rect?.height || 180) }
}

function fitWindow(target) {
  if (!target || target.closed) return
  const surfaces = [...target.document.querySelectorAll('[data-native-pip-surface]')]
  const sizes = surfaces.map(panelSize)
  if (!sizes.length) return
  const width = Math.max(...sizes.map(size => size.width))
  const height = sizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, sizes.length - 1) * 12
  // Browser-owned title bars and minimum dimensions cannot be removed.
  const desktop = target.document.documentElement.dataset.desktopPip === 'true'
  if (desktop && window.electronAPI?.nativePipGeometry && window.electronAPI?.moveLivePip) {
    const face = surfaces.length === 1 && surfaces[0].querySelector('[data-mira-face-only="true"]')
    const side = face && face.dataset.miraDetails !== 'true' ? MIRA_FACE_PADDING : 0
    const insets = { top: side, right: side, left: side, bottom: face ? MIRA_FACE_PADDING : 0 }
    const signature = JSON.stringify({ width, height, insets })
    if (target.__miraGeometry !== signature) {
      target.__miraGeometry = signature
      // Grow upwards around the face's bottom-centre; one atomic native update
      // prevents resize/move handlers from fighting over the saved position.
      window.electronAPI.moveLivePip({ width, height, insets,
        x: target.screenX + ((target.innerWidth || width) - width) / 2,
        y: target.screenY + (target.innerHeight || height) - height,
      }).catch(() => { target.__miraGeometry = null })
    }
    return
  }
  const chromeWidth = desktop ? 0 : Math.max(0, (target.outerWidth || width) - (target.innerWidth || width))
  const chromeHeight = desktop ? 0 : Math.max(0, (target.outerHeight || height) - (target.innerHeight || height))
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
    target.document.documentElement.dataset.desktopPip = String(desktop)
    target.document.title = 'Talio · Live windows'
    const base = target.document.createElement('base')
    base.href = document.baseURI
    target.document.head.append(base)
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => target.document.head.append(node.cloneNode(true)))
    target.document.documentElement.className = document.documentElement.className
    target.document.body.className = document.body.className
    if (desktop) {
      // Inline important beats inherited theme styles, including asynchronously loaded CSS.
      for (const element of [target.document.documentElement, target.document.body]) {
        element.style.setProperty('background', 'transparent', 'important')
        element.style.setProperty('background-image', 'none', 'important')
        element.style.setProperty('box-shadow', 'none', 'important')
      }
    }
    // Native children have no overlaid app title bar. Do not inherit its safe area.
    target.document.documentElement.removeAttribute('data-desktop-platform')
    for (let i = 0; i < document.documentElement.style.length; i++) {
      const key = document.documentElement.style[i]
      if (key.startsWith('--')) target.document.documentElement.style.setProperty(key, document.documentElement.style.getPropertyValue(key))
    }
    // Preserve the opener's navigation curve even after removing the desktop
    // safe-area attribute from this child window.
    target.document.documentElement.style.setProperty('--mira-window-radius', `${readMiraWindowRadius()}px`)
    const theme = document.documentElement.getAttribute('data-theme')
    if (theme) target.document.documentElement.setAttribute('data-theme', theme)
    const style = target.document.createElement('style')
    style.textContent = `html,body{margin:0;padding:0;${desktop ? 'background:transparent!important;' : ''}}body{display:flex;flex-direction:column;gap:12px;overflow:auto;background:${desktop ? 'transparent' : '#151518'};color:#f4f4f5}
      [data-native-pip-surface]:has(.mira-workspace){order:2;z-index:2147483647;border-radius:var(--mira-window-radius,22px);overflow:hidden;clip-path:inset(0 round var(--mira-window-radius,22px))}
      [data-native-pip-surface]:has([data-meeting-pip]){order:1}
      ${desktop ? '[data-native-pip-surface]{user-select:none;-webkit-app-region:no-drag;app-region:no-drag}input,textarea{user-select:text}' : ''}
      [data-native-pip-surface]{position:relative;flex-shrink:0;width:100%;isolation:isolate}
      [data-native-pip-surface] [aria-label^="Pop out"]{display:none!important}
      [data-native-pip-surface] .mira-workspace{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;aspect-ratio:auto!important;min-height:180px!important;box-sizing:border-box;transform:none!important;border-radius:var(--mira-window-radius,22px)!important}
      [data-native-pip-surface] [data-meeting-pip]{position:relative!important;inset:auto!important;margin:0 0 0 auto!important;width:var(--native-panel-width,512px)!important;max-width:100%;box-sizing:border-box}
      [data-native-pip-surface] [data-meeting-pip="expanded"]{height:var(--native-panel-height,416px)!important;max-height:none!important}
      [data-native-pip-surface] [data-meeting-pip="bubble"]{width:56px!important}
      ${desktop ? '' : `
      [data-native-pip-surface] [data-meeting-pip],
      [data-native-pip-surface] [data-meeting-pip] > header,
      [data-native-pip-surface] [data-meeting-pip] > footer{border-radius:0!important}`}`
    target.document.head.append(style)
    const faceStyle = target.document.createElement('style')
    faceStyle.textContent = `
      [data-native-pip-surface]:has([data-mira-face-only="true"]){border-radius:0!important;clip-path:none!important;overflow:visible!important;background:transparent!important}
      [data-native-pip-surface] .mira-workspace[data-mira-face-only="true"]{width:100%!important;height:var(--mira-float-height,224px)!important;max-height:100vh!important;min-height:0!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;overflow:visible!important}
      [data-native-pip-surface] [data-mira-face-only="true"] [data-mira-pip-content]{overflow:visible!important;min-height:0!important}
      [data-mira-face-only="true"]::before,[data-mira-face-only="true"]::after,[data-mira-face-only="true"]>canvas,[data-mira-face-only="true"]>[data-voice-beam-bloom],[data-mira-face-only="true"]>[data-voice-beam-warp],[data-mira-face-only="true"]>[data-voice-beam-core]{display:none!important}
    `
    target.document.head.append(faceStyle)
    if (desktop) {
      const sizing = target.document.createElement('style')
      sizing.textContent = `
        html[data-desktop-pip="true"],html[data-desktop-pip="true"] body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;overflow:hidden!important;background:transparent!important}
        html[data-desktop-pip="true"]::before,html[data-desktop-pip="true"]::after,html[data-desktop-pip="true"] body::before,html[data-desktop-pip="true"] body::after{content:none!important;display:none!important}
        html[data-desktop-pip="true"] [data-native-pip-surface]{margin:0!important;padding:0!important;min-height:0!important;line-height:normal;background:transparent!important;box-shadow:none!important}
        /* One silhouette: clip the host to the same radius as its meeting panel.
           Rings and shadows outside that silhouette produce a second dark rim. */
        [data-native-pip-surface]:has([data-meeting-pip]){background:transparent!important;overflow:hidden;border-radius:var(--meeting-pip-radius,24px)}
        [data-native-pip-surface]:has([data-meeting-pip="compact"]){--meeting-pip-radius:16px}
        [data-native-pip-surface]:has([data-meeting-pip="bubble"]){--meeting-pip-radius:9999px}
        [data-native-pip-surface] [data-meeting-pip]{border-radius:var(--meeting-pip-radius,24px)!important;box-shadow:none!important;overflow:hidden!important}
        [data-native-pip-surface] .mira-workspace{height:auto!important;aspect-ratio:auto!important;min-height:180px!important;max-height:none!important;box-sizing:border-box;overflow:hidden!important}
        /* The mono VoiceBeam paints a second bright stroke at its corners.
           Keep its interior glow, but use one clipped native panel silhouette. */
        html[data-desktop-pip="true"] [data-native-pip-surface] .mira-workspace{box-shadow:none!important;outline:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
        html[data-desktop-pip="true"] [data-native-pip-surface] .mira-workspace::after{content:none!important;display:none!important}
        [data-native-pip-surface] [data-mira-pip-content]{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
      `
      target.document.head.append(sizing)
    }
    if (desktop && window.electronAPI?.moveLivePip) {
      let drag = null, moved = false, frame = null, pendingPoint = null
      const flushDrag = () => {
        if (frame) target.cancelAnimationFrame(frame)
        frame = null
        if (pendingPoint) window.electronAPI.moveLivePip(pendingPoint).catch(() => {})
        pendingPoint = null
      }
      target.document.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button,input,textarea,a,select,[role="button"],[role="slider"],[data-mira-floating-details]')) return
        moved = false
        drag = { x: event.screenX, y: event.screenY, left: target.screenX, top: target.screenY }
        event.target.setPointerCapture?.(event.pointerId)
      })
      target.document.addEventListener('pointermove', event => {
        if (!drag) return
        const dx = event.screenX - drag.x, dy = event.screenY - drag.y
        if (!moved && Math.hypot(dx, dy) < 5) return
        moved = true
        pendingPoint = { x: drag.left + dx, y: drag.top + dy }
        if (frame) target.cancelAnimationFrame(frame)
        frame = target.requestAnimationFrame(flushDrag)
      })
      target.document.addEventListener('pointerup', () => { flushDrag(); drag = null })
      target.document.addEventListener('pointercancel', () => { flushDrag(); drag = null })
      target.document.addEventListener('click', event => { if (moved) { event.preventDefault(); event.stopPropagation(); moved = false } }, true)
    }
    target.addEventListener('pagehide', () => { if (nativeWindow === target) nativeWindow = null }, { once: true })
    return target
  } finally {
    openingWindow = null
  }
}

const NativePipSurface = forwardRef(function NativePipSurface({ children, enabled = true, automatic = false, faceOnly = false, onBackgroundChange }, ref) {
  const placeholder = useRef(null)
  const [host, setHost] = useState(null)
  const targetRef = useRef(null)
  const cleanupRef = useRef(null)
  const mounted = useRef(false)
  const enabledRef = useRef(enabled)
  const automaticRef = useRef(automatic)
  automaticRef.current = automatic
  const backgroundCallback = useRef(onBackgroundChange)
  backgroundCallback.current = onBackgroundChange
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
    // Re-appending an already inline host detaches its rendered subtree and
    // cancels CSS transitions (notably MIRA's fade-out on enabled=false).
    if (host && placeholder.current && host.parentNode !== placeholder.current) {
      placeholder.current.append(host)
      window.dispatchEvent(new Event('resize'))
    }
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
      // Browsers cannot create an alpha/frameless desktop window. Keep the
      // robot free-floating in-page rather than introduce an opaque PiP box.
      if (faceOnly && window.electronAPI?.nativePip !== true) return
      if (automaticRef.current && !isAppAway()) return
      setError('')
      try {
        const size = panelSize(host)
        const target = await getPipWindow(size)
        if (!mounted.current || !enabledRef.current || !host || (automaticRef.current && !isAppAway())) {
          if (!target.document.querySelector('[data-native-pip-surface]')) target.close()
          return
        }
        cleanupRef.current?.()
        targetRef.current = target
        const meeting = host.querySelector('[data-meeting-pip]')
        if (meeting && host.ownerDocument === document) {
          host.dataset.meetingMode = meeting.getAttribute('data-meeting-pip')
          host.dataset.meetingWidth = String(size.width)
          host.dataset.meetingHeight = String(size.height)
        }
        host.style.setProperty('--native-panel-width', `${size.width}px`)
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
        // Mode changes can replace a fixed-size panel without changing its host
        // until sizing is applied. Observe those changes as well as actual sizes.
        const modeObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => fitWindow(target))
        modeObserver?.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-meeting-pip', 'data-mira-details', 'data-mira-face-only'] })
        fitWindow(target)
        cleanupRef.current = () => { observer?.disconnect(); modeObserver?.disconnect(); target.removeEventListener('pagehide', onClose) }
      } catch (cause) {
        if (mounted.current && !fromBrowser) setError(cause?.name === 'NotAllowedError'
          ? 'MIRA is active in mini mode. Your browser blocked the external window. Allow automatic picture-in-picture for Talio, or use the desktop app for background wake.'
          : cause?.message || 'Unable to open a separate window. Try the pop-out button again.')
      }
  }

  const controls = useRef({ open, restore })
  controls.current = { open, restore }
  useEffect(() => {
    if (!automatic || !enabled || !host) return
    const unregister = registerAutomaticSurface({ open: (...args) => controls.current.open(...args) })
    let transitionTimer
    const returnWhenVisible = () => {
      clearTimeout(transitionTimer)
      const away = isAppAway()
      backgroundCallback.current?.(away)
      if (!away) controls.current.restore()
      else if (window.electronAPI?.nativePip === true || window.documentPictureInPicture?.requestWindow) {
        // Let React render the compact panel before measuring its native window.
        transitionTimer = setTimeout(() => controls.current.open(false), 100)
      }
    }
    document.addEventListener('visibilitychange', returnWhenVisible)
    window.addEventListener('focus', returnWhenVisible)
    window.addEventListener('blur', returnWhenVisible)
    returnWhenVisible()
    return () => {
      clearTimeout(transitionTimer)
      unregister()
      document.removeEventListener('visibilitychange', returnWhenVisible)
      window.removeEventListener('focus', returnWhenVisible)
      window.removeEventListener('blur', returnWhenVisible)
    }
  }, [automatic, enabled, host, faceOnly])

  useImperativeHandle(ref, () => ({ restore, open }))

  return <><div ref={placeholder} />{host && createPortal(<>{children}{error && <p role="alert" className="fixed bottom-3 left-3 z-[100000] max-w-sm rounded-xl bg-slate-900 p-3 text-sm text-white">{error}<button className="ml-2 underline" onClick={() => setError('')}>Dismiss</button></p>}</>, host)}</>
})

export default NativePipSurface
