'use client'

import { forwardRef, useEffect, useRef } from 'react'
import { AsciiReveal, AsciiSkeleton } from 'ascii-reveal'

export const LOADING_READY_EVENT = 'talio:loading-ready'

// Capture ancestors before React removes a conditional loading branch. The
// coordinator selects a surviving container after the commit, without remounting
// forms, editors, videos or their state.
export function useLoadingReady(ref, loading = true) {
  useEffect(() => {
    if (!loading || !ref.current) return
    const ancestors = []
    for (let node = ref.current.parentElement; node && node !== document.body; node = node.parentElement) {
      ancestors.push(node)
    }
    return () => window.dispatchEvent(new CustomEvent(LOADING_READY_EVENT, { detail: ancestors }))
  }, [loading, ref])
}

/** HeroUI-compatible skeleton: existing dimensions and loaded children survive. */
export const Skeleton = forwardRef(function Skeleton({
  isLoaded = false, children, className = '', classNames = {}, style,
  disableAnimation: _disableAnimation, as: Tag = 'div', ...props
}, forwardedRef) {
  const ref = useRef(null)
  useLoadingReady(ref, !isLoaded)
  return (
    <Tag {...props} ref={node => {
      ref.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    }} data-slot="skeleton" data-loaded={isLoaded ? 'true' : undefined}
      aria-busy={!isLoaded || undefined}
      className={`talio-ascii-skeleton ${className} ${classNames.base || ''}`} style={style}>
      {!isLoaded && <AsciiSkeleton variant="dither" rows={8} animate={false} width="100%" height="100%" className="talio-ascii-pattern" />}
      {children != null && <div className={classNames.content} style={isLoaded ? undefined : { visibility: 'hidden' }}>{children}</div>}
    </Tag>
  )
})

/** Explicit boundary for new data-driven components. Never delay fetching. */
export function LoadingReveal({ children, ...props }) {
  return <AsciiReveal data-talio-reveal preset="terminal" duration="fast" speed={1.6}
    shimmer={false} revealOnMount={false} fallback {...props}>{children}</AsciiReveal>
}
