'use client'

import { useEffect, useRef } from 'react'

// Fernly's landCards (.85s, y36, scale .985), fileIn (.55s, y12),
// hover lift (-4px) and magnetic controls, adapted to React-owned elements.
export default function FernlyMotion({ children, className }) {
  const root = useRef(null)
  useEffect(() => {
    const node = root.current
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const fine = matchMedia('(hover: hover) and (pointer: fine)')
    if (!node || reduced.matches || !('IntersectionObserver' in window)) return
    const animations = new Set()
    const observed = new WeakSet()
    const observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
        observer.unobserve(entry.target)
        if (reduced.matches || !entry.target.animate) return
        const card = entry.target.matches('article, section, [data-fernly-element]')
        const animation = entry.target.animate([
          { opacity: 0, transform: `translateY(${card ? 36 : 12}px) scale(${card ? .985 : 1})` },
          { opacity: 1, transform: 'none' },
        ], { duration: card ? 850 : 550, delay: Math.min(index, 6) * 50, easing: 'cubic-bezier(.22,1,.36,1)' })
        animations.add(animation)
        animation.onfinish = () => animations.delete(animation)
      })
    }, { threshold: .08 })
    const observe = () => node.querySelectorAll('article, section, h1, h2, [data-fernly-element], tbody tr').forEach(element => {
      if (!observed.has(element)) { observed.add(element); observer.observe(element) }
    })
    observe()
    const mutations = new MutationObserver(observe)
    mutations.observe(node, { childList: true, subtree: true })
    let active
    const reset = () => { if (active) { active.style.translate = ''; active = null } }
    const move = event => {
      if (reduced.matches || !fine.matches) return reset()
      const target = event.target.closest('button, article')
      if (!target || !node.contains(target) || target.disabled) return reset()
      if (active !== target) { reset(); active = target }
      if (target.matches('button')) {
        const box = target.getBoundingClientRect()
        target.style.translate = `${Math.max(-5, Math.min(5, (event.clientX-box.left-box.width/2)*.25))}px ${Math.max(-4,Math.min(4,(event.clientY-box.top-box.height/2)*.3))}px`
      } else target.style.translate = '0 -4px'
    }
    const stop = () => { reset(); animations.forEach(animation => animation.cancel()); animations.clear() }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerleave', reset)
    reduced.addEventListener('change', stop)
    return () => { stop(); observer.disconnect(); mutations.disconnect(); node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', reset); reduced.removeEventListener('change', stop) }
  }, [])
  return <div ref={root} className={className}>{children}</div>
}
