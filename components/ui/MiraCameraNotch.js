'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The camera has its own surface: it must never displace the floating Mira face.
export default function MiraCameraNotch({ camera }) {
  const [host, setHost] = useState(null), video = useRef(null), child = useRef(null)
  const visible = camera.state !== 'off'
  useEffect(() => {
    if (!visible) return
    let popup
    if (window.electronAPI) {
      popup = window.open('about:blank', 'talio-camera-notch', 'width=360,height=300')
      if (popup) {
        popup.document.title = 'Mira camera'
        popup.document.body.style.cssText = 'margin:0;background:transparent;color:#fff;font-family:system-ui'
        child.current = popup
        popup.addEventListener('pagehide', camera.stop, { once: true })
      }
    }
    setHost(popup?.document.body || document.body)
    return () => { setHost(null); if (popup && !popup.closed) { popup.removeEventListener('pagehide', camera.stop); popup.close() }; child.current = null }
  }, [visible, camera.stop])
  useEffect(() => {
    if (!video.current) return
    video.current.srcObject = camera.stream
    if (camera.stream) void video.current.play().catch(() => {})
    return () => { if (video.current) video.current.srcObject = null }
  }, [camera.stream, host])
  if (!visible || !host) return null
  return createPortal(<section aria-label="Mira camera" role="region" style={{ position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 2147483646, width: 'min(360px, 100vw)', boxSizing: 'border-box', padding: '12px 14px 14px', borderRadius: '0 0 28px 28px', background: '#0b0d10', color: '#f5f7fa', border: '1px solid #ffffff26', boxShadow: '0 12px 36px #0005', font: '13px/1.4 system-ui', animation: 'mira-camera-enter .3s ease-out' }}>
    <style>{`@keyframes mira-camera-enter{from{opacity:0;translate:0 -16px;scale:.96}to{opacity:1;translate:0 0;scale:1}}@media(prefers-reduced-motion:reduce){[aria-label="Mira camera"]{animation:none!important}}`}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: camera.stream ? '#59e3aa' : '#e5bc62' }} />
      <span style={{ flex: 1 }}>{camera.stream ? 'Camera on · auto-closes after 2 minutes' : 'Camera preview'}</span>
      <button aria-label="Close camera" onClick={camera.stop} style={{ border: 0, background: '#ffffff16', color: 'white', borderRadius: 12, width: 30, height: 30, cursor: 'pointer' }}>×</button>
    </div>
    {camera.state === 'consent' ? <>
      <p>Mira would like to look through your camera. Only a requested snapshot is sent for visual analysis; no video is recorded.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={camera.allow} style={{ padding: '10px 16px', borderRadius: 16, background: '#98d5c5', color: '#081610', border: 0, cursor: 'pointer' }}>Enable camera</button>
        <button onClick={camera.stop} style={{ padding: '10px 16px', borderRadius: 16, background: '#ffffff16', color: 'white', border: 0, cursor: 'pointer' }}>Not now</button>
      </div>
    </> : <video ref={video} muted autoPlay playsInline aria-label="Your camera preview" style={{ width: '100%', height: 187, objectFit: 'cover', borderRadius: 18, background: '#171a20', transform: 'scaleX(-1)' }} />}
    {camera.state === 'starting' && <p role="status">Starting camera…</p>}
    {camera.error && <p role="alert" style={{ color: '#ffbbb7', marginBottom: 0 }}>{camera.error}</p>}
  </section>, host)
}
