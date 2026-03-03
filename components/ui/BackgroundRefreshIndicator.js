'use client'

/**
 * BackgroundRefreshIndicator - Subtle indicator when data is being refreshed in the background
 * Shows a small pulsing dot or thin bar to indicate background activity
 * without disrupting the user experience
 * 
 * @param {Object} props
 * @param {boolean} props.isValidating - Whether SWR is currently validating/refetching
 * @param {string} props.position - Position: 'top-right' | 'inline' | 'bar'
 * @param {string} props.className - Additional classes
 */
export default function BackgroundRefreshIndicator({
  isValidating = false,
  position = 'inline',
  className = ''
}) {
  if (!isValidating) return null

  if (position === 'bar') {
    return (
      <div className={`absolute top-0 left-0 right-0 h-0.5 overflow-hidden ${className}`}>
        <div className="h-full bg-primary/40 animate-pulse" />
      </div>
    )
  }

  if (position === 'top-right') {
    return (
      <div className={`absolute top-2 right-2 ${className}`}>
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
      </div>
    )
  }

  // Inline - small refreshing text
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-default-400 ${className}`}>
      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
      Refreshing...
    </span>
  )
}

/**
 * SectionWithRefresh - Wrapper that shows refresh indicator on a section
 * 
 * @param {Object} props
 * @param {boolean} props.isValidating - SWR validating state
 * @param {React.ReactNode} props.children - Section content
 * @param {string} props.className - Additional classes
 */
export function SectionWithRefresh({ isValidating, children, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <BackgroundRefreshIndicator isValidating={isValidating} position="bar" />
      {children}
    </div>
  )
}
