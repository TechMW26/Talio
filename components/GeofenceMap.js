'use client'

import { useEffect, useRef, useState } from 'react'
import { FaMapMarkerAlt, FaSearchLocation } from 'react-icons/fa'

export default function GeofenceMap({ center, radius, onUpdate }) {
  const mapRef = useRef(null)
  const [map, setMap] = useState(null)
  const [marker, setMarker] = useState(null)
  const [circle, setCircle] = useState(null)
  // Ensure currentCenter always has lat and lng properties
  const [currentCenter, setCurrentCenter] = useState({ lat: center?.lat || 28.6139, lng: center?.lng || 77.2090 })
  const [currentRadius, setCurrentRadius] = useState(radius || 100)
  const updateTimeoutRef = useRef(null)

  // Debounced update function to avoid too many rapid calls
  const debouncedUpdate = (newPos, newRadius) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }
    updateTimeoutRef.current = setTimeout(() => {
      console.log('GeofenceMap: Calling onUpdate with', newPos, newRadius)
      onUpdate(newPos, newRadius)
    }, 300) // 300ms debounce
  }

  // Immediate update function for user actions (click, drag end)
  const immediateUpdate = (newPos, newRadius) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }
    console.log('GeofenceMap: Calling onUpdate immediately with', newPos, newRadius)
    onUpdate(newPos, newRadius)
  }

  useEffect(() => {
    // Load Google Maps script
    if (!window.google) {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
      script.async = true
      script.defer = true
      script.onload = initMap
      document.head.appendChild(script)
    } else {
      initMap()
    }
  }, [])

  useEffect(() => {
    if (map && marker && circle) {
      const newCenter = new window.google.maps.LatLng(center.lat, center.lng)
      marker.setPosition(newCenter)
      circle.setCenter(newCenter)
      circle.setRadius(radius)
      map.setCenter(newCenter)
      setCurrentCenter(center)
      setCurrentRadius(radius)
    }
  }, [center, radius])

  const initMap = () => {
    if (!mapRef.current || !window.google) return

    // Use provided center or default to New Delhi, India
    const initialCenter = {
      lat: center.lat || 28.6139,
      lng: center.lng || 77.2090
    }

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: initialCenter,
      zoom: 16,
      mapTypeControl: true,
      mapTypeControlOptions: {
        position: window.google.maps.ControlPosition.TOP_RIGHT,
      },
      streetViewControl: false,
      fullscreenControl: true,
      fullscreenControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_TOP,
      },
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_CENTER,
      },
    })

    // Add marker with custom icon
    const markerInstance = new window.google.maps.Marker({
      position: initialCenter,
      map: mapInstance,
      draggable: true,
      title: 'Drag to set geofence center',
      animation: window.google.maps.Animation.DROP,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#3B82F6',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
    })

    // Add circle with better styling
    const circleInstance = new window.google.maps.Circle({
      map: mapInstance,
      center: initialCenter,
      radius: radius || 100,
      fillColor: '#3B82F6',
      fillOpacity: 0.15,
      strokeColor: '#3B82F6',
      strokeOpacity: 0.9,
      strokeWeight: 3,
      editable: true,
      draggable: false,
    })

    // Update on marker drag start
    markerInstance.addListener('dragstart', () => {
      markerInstance.setAnimation(null)
    })

    // Update on marker drag
    markerInstance.addListener('drag', (e) => {
      const newPos = {
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      }
      circleInstance.setCenter(e.latLng)
      setCurrentCenter(newPos)
    })

    // Update on marker drag end
    markerInstance.addListener('dragend', (e) => {
      const newPos = {
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      }
      circleInstance.setCenter(e.latLng)
      setCurrentCenter(newPos)
      const radius = Math.round(circleInstance.getRadius())
      setCurrentRadius(radius)
      immediateUpdate(newPos, radius)
    })

    // Update on circle radius change
    circleInstance.addListener('radius_changed', () => {
      const newRadius = Math.round(circleInstance.getRadius())
      setCurrentRadius(newRadius)
      // Get the current center from the circle, not from state
      const center = circleInstance.getCenter()
      const newPos = {
        lat: center.lat(),
        lng: center.lng(),
      }
      debouncedUpdate(newPos, newRadius)
    })

    // Update on circle center change (when dragging the circle edge)
    circleInstance.addListener('center_changed', () => {
      const center = circleInstance.getCenter()
      const newPos = {
        lat: center.lat(),
        lng: center.lng(),
      }
      markerInstance.setPosition(center)
      setCurrentCenter(newPos)
      // Don't call onUpdate here - it will be called by radius_changed
    })

    // Click to set center
    mapInstance.addListener('click', (e) => {
      const newPos = {
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      }
      markerInstance.setPosition(e.latLng)
      circleInstance.setCenter(e.latLng)
      setCurrentCenter(newPos)
      const radius = Math.round(circleInstance.getRadius())
      immediateUpdate(newPos, radius)
    })

    setMap(mapInstance)
    setMarker(markerInstance)
    setCircle(circleInstance)
  }

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }
          if (map && marker && circle) {
            const latLng = new window.google.maps.LatLng(newPos.lat, newPos.lng)
            marker.setPosition(latLng)
            circle.setCenter(latLng)
            map.setCenter(latLng)
            setCurrentCenter(newPos)
            const radius = Math.round(circle.getRadius())
            setCurrentRadius(radius)
            immediateUpdate(newPos, radius)
          }
        },
        (error) => {
          console.error('Error getting location:', error)
          alert('Unable to get your location. Please set the location manually on the map.')
        }
      )
    } else {
      alert('Geolocation is not supported by your browser.')
    }
  }

  return (
    <div className="relative w-full h-full bg-gray-100">
      <div ref={mapRef} className="w-full h-full" />

      {/* Use Current Location Button */}
      <button
        type="button"
        onClick={getCurrentLocation}
        className="absolute top-3 left-3 bg-white shadow-xl rounded-lg px-4 py-2.5 flex items-center gap-2 hover:bg-blue-50 transition-all z-10 border border-gray-200 hover:border-blue-300"
        title="Use current location"
      >
        <FaSearchLocation className="text-blue-600" size={16} />
        <span className="text-sm font-semibold text-gray-700">My Location</span>
      </button>

      {/* Geofence Info Box */}
      <div className="absolute bottom-3 left-3 bg-white shadow-xl rounded-lg px-4 py-3 z-10 border border-gray-200">
        <div className="text-xs">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
            <FaMapMarkerAlt className="text-blue-600" size={14} />
            <span className="font-bold text-gray-800">Geofence Details</span>
          </div>
          <div className="space-y-1 text-gray-600">
            <div className="flex justify-between gap-4">
              <span className="font-medium">Latitude:</span>
              <span className="font-mono">{currentCenter.lat.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-medium">Longitude:</span>
              <span className="font-mono">{currentCenter.lng.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-medium">Radius:</span>
              <span className="font-mono font-semibold text-blue-600">{currentRadius}m</span>
            </div>
          </div>
        </div>
      </div>

      {/* Help Text */}
      <div className="absolute top-3 right-3 bg-blue-600 text-white shadow-xl rounded-lg px-3 py-2 z-10 text-xs max-w-xs">
        <div className="font-semibold mb-1">💡 Quick Tips:</div>
        <ul className="space-y-0.5 text-xs opacity-90">
          <li>• Drag the marker to move center</li>
          <li>• Drag circle edge to resize</li>
          <li>• Click map to set new center</li>
        </ul>
      </div>
    </div>
  )
}

