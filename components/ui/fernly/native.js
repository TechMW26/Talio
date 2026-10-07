'use client'
import { forwardRef } from 'react'
import styles from './elements.module.css'

// A single no-hover policy for shared cards, controls and segmented tabs.
// Preserve active, disabled and keyboard-focus treatments.
export function withoutHover(value) {
  const tokens = [value].flat().filter(Boolean).join(' ').split(/\s+/)
  const revealsAction = tokens.some(token => /group-hover(?:\/[^:]+)?:opacity-100$/.test(token))
  return tokens.filter(token => !/(^|:)(hover|group-hover)(:|\/)|data-\[hover(?:=true)?\]:/.test(token))
    .map(token => revealsAction && /(^|:)opacity-0$/.test(token) ? token.replace(/opacity-0$/, 'opacity-100') : token).join(' ')
}

// Keep native headings/controls independent of the HeroUI dependency graph.
export function element(Component, kind, slots = {}) {
  const Element = forwardRef(function FernlyElement({ className = '', classNames = {}, ...props }, ref) {
    const merged = Object.fromEntries(Object.entries(classNames).map(([slot, value]) => [slot, withoutHover(value)]))
    for (const [slot, style] of Object.entries(slots)) {
      merged[slot] = [styles[style], withoutHover(classNames[slot])].filter(Boolean).join(' ')
    }
    const stableProps = kind === 'card' && typeof Component !== 'string' ? { ...props, isHoverable: false } : props
    const RenderComponent = typeof Component === 'string' && props.as ? props.as : Component
    if (typeof Component === 'string') delete stableProps.as
    return <RenderComponent {...stableProps} ref={ref} className={[styles[kind], withoutHover(className)].filter(Boolean).join(' ')} {...(Object.keys(slots).length ? { classNames: merged } : {})} />
  })
  Element.displayName = `Fernly${kind}`
  return Element
}
export const NativeButton = element('button', 'button')
export const NativeInput = element('input', 'nativeControl')
export const NativeSelect = element('select', 'nativeControl')
export const NativeTextarea = element('textarea', 'nativeControl')
// Native card surface preserves layout and overflow for calendars, editors,
// tables and existing content without introducing a second interaction engine.
export const Surface = element('div', 'card')
export const NativeTable = element('table', 'table')
export const DialogSurface = element('div', 'dialog')
export const Heading1 = element('h1', 'heading')
export const Heading2 = element('h2', 'heading')
export const Heading3 = element('h3', 'heading')
