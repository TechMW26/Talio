/**
 * Utility function to merge class names
 * Simple implementation that handles conditional classes
 */
export function cn(...classes) {
  return classes
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Merge class names with Tailwind conflict resolution
 * For more complex cases, you can install tailwind-merge
 */
export function clsx(...args) {
  return args
    .flat()
    .filter(x => typeof x === 'string' && x.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default cn
