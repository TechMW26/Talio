'use client'

import { useEffect, useState } from 'react'

export function readMiraWindowRadius(source = document) {
  const sidebar = source.querySelector('.talio-floating-rail, .talio-floating-expanded, .talio-floating-mobile-sidebar')
  const value = sidebar ? source.defaultView.getComputedStyle(sidebar).borderTopLeftRadius : source.defaultView.getComputedStyle(source.documentElement).getPropertyValue('--dashboard-shell-radius')
  const radius = parseFloat(value)
  return Number.isFinite(radius) ? Math.max(0, radius) : 22
}

// Beam libraries require a numeric radius. Measure the canonical navigation
// instead of duplicating its platform-specific geometry in their props.
export default function useMiraWindowRadius(open) {
  const [radius, setRadius] = useState(22)
  useEffect(() => {
    const update = () => setRadius(readMiraWindowRadius())
    update()
    window.addEventListener('resize', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-desktop-platform', 'style', 'class'] })
    return () => { window.removeEventListener('resize', update); observer.disconnect() }
  }, [open])
  return radius
}
