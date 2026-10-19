// robot-heads 0.3.0 assumes a single document. Mira's portal moves its canvas
// into an Electron child window: use that window's clock, visibility and mouse.
const entries = new Set(), documents = new Map()
let adoptionTimer
function release(doc, loop) {
  loop.view?.cancelAnimationFrame(loop.frame)
  doc.removeEventListener('pointermove', loop.move)
  doc.removeEventListener('pointerleave', loop.leave)
  doc.removeEventListener('visibilitychange', loop.visibility)
  loop.view?.removeEventListener('blur', loop.leave)
  documents.delete(doc)
}
function reconcile() {
  const needed = new Set([...entries].map(entry => entry.document()).filter(doc => doc?.defaultView && !doc.defaultView.closed))
  for (const [doc, loop] of documents) if (!needed.has(doc)) release(doc, loop)
  for (const doc of needed) {
    if (documents.has(doc)) continue
    const view = doc.defaultView
    const loop = { view, frame: 0, last: 0, pointer: { x: NaN, y: NaN } }
    const tick = now => {
      loop.frame = 0
      if (doc.hidden || view.closed) return
      // A small animated face does not need 120/144 canvas paints per second.
      // Keep elapsed-time animation and pointer tracking, capped at 30fps.
      if (loop.last && now - loop.last < 1000 / 30 - 1) { loop.frame = view.requestAnimationFrame(tick); return }
      const delta = loop.last ? Math.min(.1, (now - loop.last) / 1000) : 0
      loop.last = now
      entries.forEach(entry => {
        if (entry.document() !== doc) return
        // Hidden/offscreen duplicate faces should not rasterize on every frame.
        // Recheck slowly, including when a canvas moves into the PiP document.
        if (!entry.checked || now - entry.checked > 500 || entry.owner !== doc) {
          const rect = entry.element?.()?.getBoundingClientRect?.()
          entry.visible = !rect || (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth)
          entry.checked = now; entry.owner = doc
        }
        if (entry.visible) entry.draw(delta)
      })
      loop.frame = view.requestAnimationFrame(tick)
    }
    loop.move = event => { loop.pointer.x = event.clientX; loop.pointer.y = event.clientY }
    loop.leave = () => { loop.pointer.x = NaN; loop.pointer.y = NaN }
    loop.visibility = () => {
      view.cancelAnimationFrame(loop.frame); loop.frame = 0; loop.last = 0
      if (!doc.hidden) loop.frame = view.requestAnimationFrame(tick)
    }
    documents.set(doc, loop)
    doc.addEventListener('pointermove', loop.move, { passive: true })
    doc.addEventListener('pointerleave', loop.leave)
    doc.addEventListener('visibilitychange', loop.visibility)
    view.addEventListener('blur', loop.leave)
    loop.visibility()
  }
}
export function robotPointer(doc) { return documents.get(doc)?.pointer || { x: NaN, y: NaN } }
export function subscribeRobotFrame(draw, document, element) {
  const entry = { draw, document, element }
  entries.add(entry); reconcile()
  // Canvas adoption doesn't remount React. Detect it even when the opener's
  // RAF is suspended; only this lightweight check runs while all tabs sleep.
  if (!adoptionTimer) adoptionTimer = setInterval(reconcile, 250)
  return () => {
    entries.delete(entry); reconcile()
    if (!entries.size) { clearInterval(adoptionTimer); adoptionTimer = null }
  }
}
