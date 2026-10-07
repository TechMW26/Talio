'use client'

import { useEffect, useRef } from 'react'

// Fernly entrance animations only. Cards and controls stay still on hover.
export default function FernlyMotion({ children, className }) {
  const root = useRef(null)
  useEffect(() => {
    const node = root.current
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
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
    const stop = () => { animations.forEach(animation => animation.cancel()); animations.clear() }
    reduced.addEventListener('change', stop)
    return () => { stop(); observer.disconnect(); mutations.disconnect(); reduced.removeEventListener('change', stop) }
  }, [])
  return <div ref={root} className={className}>{children}</div>
}
