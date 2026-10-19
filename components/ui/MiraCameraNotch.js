'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function MiraCameraNotch({ camera }) {
  const [host, setHost] = useState(null), [mounted, setMounted] = useState(false)
  const video = useRef(null)
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
  if (!mounted || !host) return null
  const native = host.ownerDocument !== document
  return createPortal(<section aria-label="Mira camera" role="region" data-open={visible} style={{ position: 'fixed', top: 0, left: '50%', translate: '-50% 0', zIndex: 2147483646, width: native ? '100vw' : 'min(240px, 100vw)', boxSizing: 'border-box', padding: 'calc(var(--mira-camera-inset, 0px) + 6px) 8px 8px', borderRadius: '0 0 14px 14px', background: '#000', color: '#fff', border: 0, boxShadow: 'none', font: '12px/1.3 system-ui', transformOrigin: '50% 0', animation: visible ? 'mira-notch-emerge 620ms both' : 'mira-notch-retract 300ms both', animationPlayState: native ? 'var(--mira-camera-animation-state, paused)' : 'running' }}>
    <style>{`@keyframes mira-notch-emerge{0%{transform:translateY(-85%) scale(.88,.2);border-radius:0 0 45% 45%;opacity:0}45%{transform:translateY(0) scale(1.035,1.07);opacity:1}72%{transform:scale(.99,.975);border-radius:0 0 18px 18px}100%{transform:scale(1);opacity:1}}@keyframes mira-notch-retract{0%{transform:scale(1);opacity:1}45%{transform:scale(.97,1.04)}100%{transform:translateY(-100%) scale(.85,.2);border-radius:0 0 50% 50%;opacity:0}}@media(prefers-reduced-motion:reduce){[aria-label="Mira camera"]{animation:none!important}[aria-label="Mira camera"][data-open="false"]{opacity:0}}`}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24 }}>
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: camera.stream ? '#59e3aa' : '#e5bc62' }} />
      <span style={{ flex: 1 }}>{camera.stream ? 'Camera on' : camera.error ? 'Camera unavailable' : 'Starting camera…'}</span>
      <button aria-label="Close camera" onClick={camera.stop} style={{ border: 0, background: 'transparent', color: 'white', width: 28, height: 24, cursor: 'pointer', fontSize: 20 }}>×</button>
    </div>
    <video ref={video} muted autoPlay playsInline aria-label="Your camera preview" style={{ display: camera.error ? 'none' : 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 9, background: '#000', transform: 'scaleX(-1)' }} />
    {camera.error && <p role="alert" style={{ color: '#ffbbb7', margin: '6px 0 0', fontSize: 11 }}>{camera.error}</p>}
  </section>, host)
}
