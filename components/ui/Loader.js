'use client'

import { useId } from 'react'

// Talio brand color
const TALIO_TEAL = '#7DBCAF'

// Pre-calculated path length for the fox SVG (avoids flash of black/unstyled content)
// This value was calculated using getTotalLength() on the SVG path
const FOX_PATH_LENGTH = 4700

// The fox SVG path data
const FOX_PATH = "M218.185 401.899C213.175 405.409 205.665 410.209 201.505 412.549L193.935 416.819L189.125 414.309C160.555 399.389 135.805 375.379 112.155 339.649L106.765 331.509L110.285 328.509C112.225 326.859 113.805 325.139 113.805 324.689C113.805 322.859 101.875 311.469 95.305 307.029C83.255 298.879 72.455 294.379 59.375 292.059C52.495 290.839 35.495 290.769 28.465 291.919C24.655 292.549 23.515 292.419 23.075 291.279C22.235 289.079 24.635 267.739 26.945 257.059C31.605 235.419 41.995 208.849 51.455 194.429C52.745 192.449 52.255 191.349 44.945 179.899C27.095 151.939 14.145 121.479 6.915 90.5085C0.754998 64.0785 -1.615 31.4185 1.135 10.6085C1.975 4.23853 2.785 1.40853 4.005 0.64853C9.065 -2.52147 39.985 6.51853 62.255 17.6785C96.355 34.7685 124.205 56.0885 158.125 91.0885L176.465 110.009H193.385L210.305 109.999L221.305 98.0185C243.725 73.5985 270.475 50.6185 296.315 33.5885C303.725 28.6985 308.245 26.0985 322.805 18.3585C332.255 13.3285 353.105 4.88853 360.805 2.98853C376.165 -0.81147 380.135 -0.93147 382.265 2.30853C384.815 6.19853 386.105 27.2385 384.815 44.0085C381.675 84.8885 371.875 119.939 353.105 157.399C347.505 168.569 346.875 169.669 337.885 183.689L332.645 191.859L336.055 197.189C349.295 217.879 360.175 252.099 362.705 281.009C363.735 292.799 363.335 293.439 355.875 292.019C343.145 289.609 323.715 291.709 310.075 296.969C297.415 301.849 282.845 312.119 275.595 321.269L272.465 325.229L276.225 328.379L279.975 331.529L273.795 340.949C257.305 366.049 235.945 389.469 218.185 401.899ZM67.095 162.839L71.135 169.159L75.225 164.359C81.485 156.999 95.305 143.529 104.325 135.999C113.865 128.029 133.585 113.029 135.485 112.299C136.215 112.019 136.805 111.429 136.805 110.979C136.805 108.299 114.365 87.1485 95.305 71.8585C79.025 58.7985 49.815 41.4285 35.925 36.5485C35.665 36.4485 35.405 36.3585 35.155 36.2685C32.345 35.2785 30.705 34.6985 29.805 35.2785C28.535 36.0685 28.685 39.0985 29.035 46.3285C29.065 46.7885 29.085 47.2685 29.105 47.7585C30.865 84.3585 45.725 129.349 67.095 162.839ZM311.415 164.889L314.195 168.259L316.245 165.679C319.605 161.459 329.665 142.809 334.825 131.259C341.895 115.409 346.765 101.229 350.355 86.0085C351.205 82.4385 352.325 77.7085 352.845 75.5085C353.375 73.3085 354.015 70.1585 354.275 68.5085C356.185 56.2785 356.765 50.4385 356.785 43.1485L356.805 34.7885L354.055 35.4685C349.035 36.7085 334.085 43.7585 323.425 49.8985C309.895 57.6885 298.105 66.0185 284.055 77.7185C271.155 88.4585 249.535 109.769 250.295 110.999C250.575 111.449 255.395 115.099 261.005 119.099C277.805 131.089 300.715 151.909 311.415 164.889ZM133.395 304.289L141.305 312.679L154.965 302.299C162.485 296.589 169.175 291.269 169.835 290.469C170.805 289.299 170.225 287.719 166.805 282.269C148.655 253.309 123.965 230.579 96.805 217.809C92.685 215.869 86.165 213.039 82.335 211.529L75.365 208.769L72.695 211.979C64.785 221.449 50.405 265.279 55.535 264.269C57.955 263.789 78.115 268.159 85.145 270.699C101.125 276.459 118.685 288.679 133.395 304.289ZM238.005 307.059L245.035 312.599L256.675 301.009C269.605 288.119 283.235 278.369 296.305 272.679C304.535 269.089 321.045 265.009 327.315 265.009C331.755 265.009 332.365 263.579 330.815 256.769C327.495 242.159 315.305 211.669 311.955 209.599C309.355 207.999 284.825 219.279 270.805 228.539C257.485 237.329 247.035 246.559 237.645 257.829C230.125 266.859 215.805 287.399 215.805 289.159C215.805 289.589 219.215 292.539 223.395 295.719C227.565 298.909 234.145 304.009 238.005 307.059ZM184.085 373.029L193.035 378.929L197.175 376.829C202.805 373.959 214.415 365.089 219.415 359.829C224.665 354.299 233.805 342.059 233.805 340.549C233.805 339.429 231.465 337.619 217.805 328.119C196.395 313.249 193.945 311.869 191.475 313.229C188.405 314.909 159.105 335.289 155.525 338.229L152.755 340.509L156.175 345.569C162.345 354.679 174.735 366.869 184.085 373.029Z"

/**
 * Talio Branded Loader Component
 * A beautiful animated SVG loader with stroke drawing and fill effects
 * Always shows the animated teal version - no static black fallback
 * 
 * @param {Object} props
 * @param {string} props.size - Size preset: 'xs' | 'sm' | 'md' | 'lg' | 'xl' (default: 'md')
 * @param {string} props.className - Additional CSS classes
 * @param {string} props.color - Custom color (default: '#7DBCAF' - Talio teal)
 */
export default function Loader({ size = 'md', className = '', color = TALIO_TEAL }) {
  // Size presets in pixels
  const sizeMap = {
    xs: 16,
    sm: 24,
    md: 48,
    lg: 64,
    xl: 96,
  }

  const pixelSize = sizeMap[size] || sizeMap.md

  // Use React's useId for stable server/client ID generation (no hydration mismatch)
  const reactId = useId()
  // Convert to CSS-safe ID (remove colons)
  const uniqueId = `loader${reactId.replace(/:/g, '')}`

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        /* Stroke Animation: Draw (0-40%), Hold (40-60%), Undraw (60-100%) */
        @keyframes ${uniqueId}-strokeLoop {
          0% { stroke-dashoffset: ${FOX_PATH_LENGTH}; }
          40% { stroke-dashoffset: 0; }
          60% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: ${FOX_PATH_LENGTH}; }
        }
        
        /* Fill Animation: Hidden (0-40%), Fade In (40-50%), Fade Out (50-90%), Hidden (90-100%) */
        @keyframes ${uniqueId}-fillLoop {
          0%, 40% { opacity: 0; }
          50% { opacity: 1; }
          90%, 100% { opacity: 0; }
        }
        
        /* Pulse Animation: Matches stroke timing */
        @keyframes ${uniqueId}-pulse {
          0% { transform: scale(0.95); }
          40%, 60% { transform: scale(1); }
          100% { transform: scale(0.95); }
        }
        
        .${uniqueId}-container {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
          padding: 8px;
          animation: ${uniqueId}-pulse 2.5s ease-in-out infinite;
          overflow: visible;
        }
        
        .${uniqueId}-stroke {
          stroke: ${color};
          stroke-width: 8;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none !important;
          stroke-dasharray: ${FOX_PATH_LENGTH};
          stroke-dashoffset: ${FOX_PATH_LENGTH};
          animation: ${uniqueId}-strokeLoop 2.5s ease-in-out infinite;
        }
        
        .${uniqueId}-fill {
          fill: ${color} !important;
          stroke: none !important;
          opacity: 0;
          animation: ${uniqueId}-fillLoop 2.5s linear infinite;
        }
      `}} />
      <div 
        className={`${uniqueId}-container ${className}`}
        style={{
          width: pixelSize,
          height: pixelSize,
        }}
      >
        <svg 
          viewBox="-10 -10 405.322 436.819" 
          xmlns="http://www.w3.org/2000/svg"
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            overflow: 'visible',
            filter: `drop-shadow(0 0 15px ${color}4D)`,
          }}
        >
          {/* Base Layer - Always visible teal fill to prevent any black flash */}
          <path 
            d={FOX_PATH}
            style={{
              fill: color,
              stroke: 'none',
              opacity: 0.15,
            }}
          />
          {/* Stroke Layer - Animated outline that draws and undraws */}
          <path 
            className={`${uniqueId}-stroke`} 
            d={FOX_PATH}
            style={{
              fill: 'none',
              stroke: color,
              strokeWidth: 8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }}
          />
          {/* Fill Layer - Fades in and out */}
          <path 
            className={`${uniqueId}-fill`} 
            d={FOX_PATH}
            style={{
              fill: color,
              stroke: 'none',
            }}
          />
        </svg>
      </div>
    </>
  )
}

/**
 * Page-level loader wrapper with centered positioning
 */
export function PageLoader({ message = 'Loading...', size = 'lg' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] w-full">
      <Loader size={size} />
      {message && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400 animate-pulse text-center">
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * Full-screen loader overlay
 */
export function FullScreenLoader({ message = 'Loading...' }) {
  return (
    <div className="fixed inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="flex flex-col items-center">
        <Loader size="xl" />
        {message && (
          <p className="mt-6 text-lg text-gray-600 dark:text-gray-300 animate-pulse text-center">
            {message}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Inline button loader (for use inside buttons)
 */
export function ButtonLoader({ className = '' }) {
  return <Loader size="xs" className={className} />
}
