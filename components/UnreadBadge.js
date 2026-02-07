'use client'

import { useTheme } from '@/contexts/ThemeContext'

export default function UnreadBadge({ count, className = '' }) {
  const { currentTheme, themes } = useTheme()
  const theme = themes[currentTheme] || themes.default

  if (!count || count === 0) return null

  // Format count (show 99+ for counts over 99)
  const displayCount = count > 99 ? '99+' : count
  
  // Calculate size based on digit count for perfect circle
  const isLargeNumber = count > 9
  const size = isLargeNumber ? '22px' : '20px'

  return (
    <span
      className={`absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 text-white font-bold rounded-full flex items-center justify-center shadow-lg ring-2 ring-white ${className}`}
      style={{
        fontSize: isLargeNumber ? '10px' : '11px',
        backgroundColor: '#ef4444', // Bright red for better visibility
        zIndex: 50,
        pointerEvents: 'none',
        minWidth: size,
        width: isLargeNumber ? 'auto' : size,
        height: size,
        paddingLeft: isLargeNumber ? '5px' : '0',
        paddingRight: isLargeNumber ? '5px' : '0',
      }}
    >
      {displayCount}
    </span>
  )
}

