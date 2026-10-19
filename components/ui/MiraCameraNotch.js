'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AIActivityBeam from './AIActivityBeam'

export default function MiraCameraNotch({ camera }) {
  const [host, setHost] = useState(null), [mounted, setMounted] = useState(false)
  const video = useRef(null)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)
  const visible = camera.state !== 'off'
  useEffect(() => {
    if (visible) { setMounted(true); return }
    const timer = setTimeout(() => setMounted(false), 320)
    return () => clearTimeout(timer)
  }, [visible])
  useEffect(() => {
    if (!mounted) return
    let popup
    if (window.electronAPI) {
      popup = window.open('about:blank', 'talio-camera-notch', 'width=240,height=200')
      if (popup) {
        popup.document.title = 'Mira camera'
        popup.document.body.style.cssText = 'margin:0;background:transparent;color:#fff;font-family:system-ui;overflow:hidden'
        document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => popup.document.head.append(node.cloneNode(true)))
        popup.addEventListener('pagehide', camera.stop, { once: true })
      }
    }
    setHost(popup?.document.body || document.body)
    return () => { setHost(null); if (popup && !popup.closed) { popup.removeEventListener('pagehide', camera.stop); popup.close() } }
  }, [mounted, camera.stop])
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = camera.stream
    if (camera.stream) void element.play().catch(() => {})
    return () => { element.srcObject = null }
  }, [camera.stream, host])
  useEffect(() => {
    const settings = camera.stream?.getVideoTracks()[0]?.getSettings?.()
    if (settings?.width > 0 && settings?.height > 0) setAspectRatio(settings.width / settings.height)
  }, [camera.stream])
  useEffect(() => {
    if (host && host.ownerDocument !== document) window.electronAPI?.resizeMiraCamera?.({ aspectRatio })
  }, [aspectRatio, host])
  if (!mounted || !host) return null
  const native = host.ownerDocument !== document
  return createPortal(<section aria-label="Mira camera" role="region" data-open={visible} style={{
    position: 'fixed', top: 0, left: '50%', translate: '-50% 0', zIndex: 2147483646,
    width: native ? '100vw' : 'min(240px, 100vw)', boxSizing: 'border-box', padding: '0 6px 6px',
    overflow: 'hidden', borderRadius: '0 0 14px 14px', background: '#000', color: '#fff',
    border: 0, boxShadow: 'none', font: '12px/1.3 system-ui', transformOrigin: '50% 0',
    animationName: visible ? 'mira-notch-emerge' : 'mira-notch-retract',
    animationDuration: visible ? '620ms' : '300ms', animationFillMode: 'both',
    animationPlayState: native ? 'var(--mira-camera-animation-state, paused)' : 'running',
  }}>
    <style>{`@keyframes mira-notch-emerge{0%{transform:translateY(-85%) scale(.88,.2);border-radius:0 0 45% 45%;opacity:0}45%{transform:translateY(0) scale(1.035,1.07);opacity:1}72%{transform:scale(.99,.975);border-radius:0 0 18px 18px}100%{transform:scale(1);opacity:1}}@keyframes mira-notch-retract{0%{transform:scale(1);opacity:1}45%{transform:scale(.97,1.04)}100%{transform:translateY(-100%) scale(.85,.2);border-radius:0 0 50% 50%;opacity:0}}@media(prefers-reduced-motion:reduce){[aria-label="Mira camera"]{animation:none!important}[aria-label="Mira camera"][data-open="false"]{opacity:0}}`}</style>
    <video ref={video} muted autoPlay playsInline aria-label="Your camera preview" onLoadedMetadata={event => { const element = event.currentTarget; if (element.videoWidth && element.videoHeight) setAspectRatio(element.videoWidth / element.videoHeight) }} onResize={event => { const element = event.currentTarget; if (element.videoWidth && element.videoHeight) setAspectRatio(element.videoWidth / element.videoHeight) }} style={{ display: camera.error ? 'none' : 'block', width: '100%', aspectRatio, objectFit: 'contain', borderRadius: '0 0 9px 9px', background: '#000', transform: 'scaleX(-1)' }} />
    {camera.capturing && <AIActivityBeam active theme="dark" borderRadius={14} />}
    {camera.error && <p role="alert" style={{ color: '#ffbbb7', margin: '6px 0 0', fontSize: 11 }}>{camera.error}</p>}
  </section>, host)
}
