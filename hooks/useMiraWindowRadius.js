'use client'

import { useEffect, useState } from 'react'

export function readMiraWindowRadius(source = document, surface = 'sidebar') {
  if (surface === 'pip' && source.documentElement.dataset.desktopPlatform === 'darwin') {
    // The floating PiP is a window, not inset navigation: do not subtract
    // the sidebar's distance from the outer macOS window curve.
    const radius = parseFloat(source.defaultView.getComputedStyle(source.documentElement).getPropertyValue('--dashboard-window-radius'))
    return Number.isFinite(radius) ? Math.max(0, radius) : 14
  }
  const sidebar = source.querySelector('.talio-floating-rail, .talio-floating-expanded, .talio-floating-mobile-sidebar')
  const value = sidebar ? source.defaultView.getComputedStyle(sidebar).borderTopLeftRadius : source.defaultView.getComputedStyle(source.documentElement).getPropertyValue('--dashboard-shell-radius')
  const radius = parseFloat(value)
  return Number.isFinite(radius) ? Math.max(0, radius) : 22
}

// Beam libraries require a numeric radius. Resolve the appropriate canonical
// surface instead of duplicating its platform-specific geometry in their props.
export default function useMiraWindowRadius(open, surface = 'sidebar') {
  const [radius, setRadius] = useState(22)
  useEffect(() => {
    const update = () => setRadius(readMiraWindowRadius(document, surface))
    update()
    window.addEventListener('resize', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-desktop-platform', 'style', 'class'] })
    return () => { window.removeEventListener('resize', update); observer.disconnect() }
  }, [open, surface])
  return radius
}
