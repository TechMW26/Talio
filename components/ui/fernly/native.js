'use client'
import { forwardRef } from 'react'
import styles from './elements.module.css'

// Keep native headings/controls independent of the HeroUI dependency graph.
export function element(Component, kind, slots = {}) {
  const Element = forwardRef(function FernlyElement({ className = '', classNames = {}, ...props }, ref) {
    const merged = { ...classNames }
    for (const [slot, style] of Object.entries(slots)) {
      merged[slot] = [styles[style], classNames[slot]].filter(Boolean).flat().join(' ')
    }
    return <Component {...props} ref={ref} className={[styles[kind], className].filter(Boolean).join(' ')} {...(Object.keys(slots).length ? { classNames: merged } : {})} />
  })
  Element.displayName = `Fernly${kind}`
  return Element
}
export const NativeButton = element('button', 'button')
export const NativeInput = element('input', 'nativeControl')
export const NativeSelect = element('select', 'nativeControl')
export const NativeTextarea = element('textarea', 'nativeControl')
export const Heading1 = element('h1', 'heading')
export const Heading2 = element('h2', 'heading')
export const Heading3 = element('h3', 'heading')
