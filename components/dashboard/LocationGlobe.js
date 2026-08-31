'use client'

import { useEffect, useRef, useState } from 'react'

const EARTH_DAY = '/maps/earth-blue-marble.jpg'
const EARTH_NIGHT = '/maps/earth-night.jpg'
const EARTH_BUMP = '/maps/earth-topology.png'
const LOCATION_VIEW_ALTITUDE = 0.72
const RECENTER_DELAY_MS = 2000

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

/**
 * 3D earth that animates into view of the user's coordinates.
 * Mounted only after geolocation resolves, so `lat`/`lon` are stable.
 */
function antipodeOf(lat, lon) {
  const lng = lon >= 0 ? lon - 180 : lon + 180
  return { lat: -lat, lng }
}

export default function LocationGlobe({ lat, lon, isDarkMode, onZoomChange }) {
  const containerRef = useRef(null)
  const globeRef = useRef(null)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    if (!supportsWebGL()) {
      setUnsupported(true)
      return
    }

    let disposed = false
    let globe = null
    let controls = null
    let resizeObserver = null
    let recenterTimer = null

    const cancelRecenter = () => {
      if (recenterTimer) {
        clearTimeout(recenterTimer)
        recenterTimer = null
      }
    }
    const scheduleRecenter = () => {
      cancelRecenter()
      recenterTimer = setTimeout(() => {
        recenterTimer = null
        if (disposed || !globeRef.current) return
        globeRef.current.pointOfView(
          { lat, lng: lon, altitude: LOCATION_VIEW_ALTITUDE },
          900
        )
      }, RECENTER_DELAY_MS)
    }

    import('globe.gl').then(({ default: Globe }) => {
      const el = containerRef.current
      if (disposed || !el) return

      globe = Globe()(el)
        .globeImageUrl(isDarkMode ? EARTH_NIGHT : EARTH_DAY)
        .bumpImageUrl(EARTH_BUMP)
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor(isDarkMode ? '#818cf8' : '#93c5fd')
        .atmosphereAltitude(0.18)
        .showGraticules(false)
        .pointsData([{ lat, lon, size: 0.55 }])
        .pointLat('lat')
        .pointLng('lon')
        .pointAltitude('size')
        .pointRadius(0.28)
        .pointColor(() => '#22c55e')
        .ringsData([{ lat, lon }])
        .ringLat('lat')
        .ringLng('lon')
        .ringColor(() => t => `rgba(34,197,94,${1 - t})`)
        .ringMaxRadius(4)
        .ringPropagationSpeed(1.5)
        .ringRepeatPeriod(1400)

      globeRef.current = globe

      controls = globe.controls()
      controls.autoRotate = false
      controls.enableZoom = true
      controls.zoomSpeed = 0.5
      controls.enablePan = false
      controls.minDistance = 70
      controls.maxDistance = 600

      controls.addEventListener('start', cancelRecenter)
      controls.addEventListener('end', scheduleRecenter)

      // Start fully zoomed out, facing the opposite point of the earth so the
      // globe rotates into view toward the user's location.
      const start = antipodeOf(lat, lon)
      globe.pointOfView({ lat: start.lat, lng: start.lng, altitude: 2.6 }, 0)
      onZoomChange?.(false)

      globe.onGlobeReady(() => {
        setTimeout(() => {
          if (disposed || !globeRef.current) return
          // Fill the wide dashboard card and let the four-sided card vignette
          // soften the intentional crop around the globe's outer edge.
          globeRef.current.pointOfView(
            { lat, lng: lon, altitude: LOCATION_VIEW_ALTITUDE },
            2600
          )
          setTimeout(() => {
            if (!disposed) onZoomChange?.(true)
          }, 2700)
        }, 500)
      })

      const resize = () => {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          globe.width(rect.width).height(rect.height)
        }
      }
      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(el)
    })

    return () => {
      disposed = true
      if (recenterTimer) clearTimeout(recenterTimer)
      if (controls) {
        controls.removeEventListener('start', cancelRecenter)
        controls.removeEventListener('end', scheduleRecenter)
      }
      if (resizeObserver) resizeObserver.disconnect()
      if (globeRef.current && typeof globeRef.current._destructor === 'function') {
        globeRef.current._destructor()
      }
      globeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap day/night texture when the theme changes.
  useEffect(() => {
    const globe = globeRef.current
    if (globe) globe.globeImageUrl(isDarkMode ? EARTH_NIGHT : EARTH_DAY)
  }, [isDarkMode])

  if (unsupported) {
    return (
      <div className="w-full h-full flex items-center justify-center px-4 py-3 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Your browser does not support 3D maps.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="3D earth showing your current location"
      data-testid="location-globe"
      className="relative h-full w-full overflow-hidden"
    />
  )
}
