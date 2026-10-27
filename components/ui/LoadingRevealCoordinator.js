'use client'

import { useEffect } from 'react'
import { createAsciiReveal } from 'ascii-reveal'
import { LOADING_READY_EVENT } from './AsciiLoading'

const pendingSelector = '[data-slot="skeleton"]:not([data-loaded="true"]), [data-page-skeleton], [data-talio-loading]'

// One batched, event-driven coordinator for pages, independently loaded widgets,
// and portals. No subtree-wide mutation observer or per-placeholder animation loop.
export default function LoadingRevealCoordinator() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const queued = new Set()
    const active = new Map()
    let frame = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      queued.clear()
      active.forEach(controller => controller.destroy())
      active.clear()
    }
    const flush = () => {
      frame = 0
      const targets = [...queued].filter(node => node.isConnected &&
        !node.closest('[hidden], [data-ascii="skip"]') && !node.querySelector(pendingSelector))
      queued.clear()
      if (document.hidden || reduced.matches) return
      for (const node of targets.filter(node => !targets.some(other => other !== node && other.contains(node)))) {
        const rect = node.getBoundingClientRect()
        if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= window.innerHeight) continue
        // Inputs, media streams, charts and interactive controls stay untouched.
        active.get(node)?.destroy()
        let controller
        try {
          controller = createAsciiReveal(node, {
            preset: 'terminal', duration: 'fast', speed: 1.6, lazy: false, fallback: true,
            selector: 'h1, h2, h3, h4, p, td, th, dt, dd, [data-ascii="text"]',
            media: '[data-ascii="media"]',
          })
          active.set(node, controller)
          controller.reveal().catch(() => {}).finally(() => {
            controller.destroy()
            if (active.get(node) === controller) active.delete(node)
          })
        } catch {
          // Decorative effects must never prevent real data from being read.
          controller?.destroy()
          active.delete(node)
        }
      }
    }
    const ready = event => {
      const node = event.detail?.find?.(ancestor => ancestor.isConnected)
      if (!node || reduced.matches || node.closest('[data-talio-reveal]')) return
      queued.add(node)
      if (!frame) frame = requestAnimationFrame(flush)
    }
    window.addEventListener(LOADING_READY_EVENT, ready)
    reduced.addEventListener('change', stop)
    return () => {
      window.removeEventListener(LOADING_READY_EVENT, ready)
      reduced.removeEventListener('change', stop)
      stop()
    }
  }, [])
  return null
}
