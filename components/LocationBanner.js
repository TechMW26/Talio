'use client'

import { useState, useEffect } from 'react'
import { FaMapMarkerAlt, FaTimes } from 'react-icons/fa'
import toast from '@/utils/toast'

/**
 * Persistent Location Banner
 * Shows when location permission is disabled or denied
 * Prompts user to enable location access
 */
export default function LocationBanner() {
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [permissionState, setPermissionState] = useState('prompt')

  useEffect(() => {
    const checkLocationStatus = async () => {
      try {
        // Check if geolocation is supported
        if (!navigator.geolocation) {
          console.log('[LocationBanner] Geolocation not supported')
          return
        }

        // Check localStorage first
        const savedPermission = localStorage.getItem('location-permission')
        
        // Try Permissions API
        if (navigator.permissions) {
          try {
            const result = await navigator.permissions.query({ name: 'geolocation' })
            const state = result.state // 'granted', 'denied', or 'prompt'
            setPermissionState(state)
            
            console.log('[LocationBanner] Permission state:', state)
            
            // Show banner if not granted
            if (state !== 'granted' && !dismissed) {
              setShow(true)
            } else {
              setShow(false)
            }
            
            // Listen for permission changes
            result.onchange = () => {
              const newState = result.state
              console.log('[LocationBanner] Permission changed to:', newState)
              setPermissionState(newState)
              
              if (newState === 'granted') {
                setShow(false)
                localStorage.setItem('location-permission', 'granted')
              } else if (!dismissed) {
                setShow(true)
              }
            }
          } catch (error) {
            console.log('[LocationBanner] Permissions API failed:', error)
            // Fallback to localStorage
            if (savedPermission !== 'granted' && !dismissed) {
              setShow(true)
            }
          }
        } else {
          // Fallback for browsers without Permissions API
          if (savedPermission !== 'granted' && !dismissed) {
            setShow(true)
          }
        }

        // Check permission status every 5 seconds
        const interval = setInterval(async () => {
          if (navigator.permissions) {
            try {
              const result = await navigator.permissions.query({ name: 'geolocation' })
              const state = result.state
              setPermissionState(state)
              
              if (state !== 'granted' && !dismissed) {
                setShow(true)
              } else {
                setShow(false)
              }
            } catch (error) {
              // Ignore errors
            }
          }
        }, 5000)

        return () => clearInterval(interval)
      } catch (error) {
        console.error('[LocationBanner] Error checking status:', error)
      }
    }

    checkLocationStatus()
  }, [dismissed])

  const handleEnable = async () => {
    try {
      console.log('[LocationBanner] Enable button clicked')
      
      if (!navigator.geolocation) {
        toast.error('Location services not supported on this device', {
          duration: 3000,
          icon: '📍'
        })
        return
      }

      console.log('[LocationBanner] Requesting location permission...')
      
      // Request location permission by attempting to get position
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('[LocationBanner] Location permission granted!', position)
          
          // Save to localStorage
          localStorage.setItem('location-permission', 'granted')
          localStorage.setItem('last-location', JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: Date.now()
          }))
          
          toast.success('Location access enabled!', {
            icon: '📍',
            duration: 2000
          })
          
          setShow(false)
          setPermissionState('granted')
        },
        (error) => {
          console.error('[LocationBanner] Location permission error:', error)
          
          // Save denial to localStorage
          localStorage.setItem('location-permission', 'denied')
          setPermissionState('denied')
          
          let errorMessage = 'Location access denied'
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Please enable location access in your browser settings to use attendance features'
              break
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information unavailable. Please check your device settings'
              break
            case error.TIMEOUT:
              errorMessage = 'Location request timed out. Please try again'
              break
          }
          
          toast.error(errorMessage, {
            duration: 5000,
            icon: '📍'
          })
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      )
    } catch (error) {
      console.error('[LocationBanner] Error enabling location:', error)
      toast.error('Failed to enable location access', {
        duration: 3000,
        icon: '📍'
      })
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    setShow(false)
  }

  if (!show) {
    return null
  }

  return (
    <div className="fixed top-[140px] left-0 right-0 z-[54] px-4 md:px-6 animate-slideDown">
      <div 
        className="max-w-4xl mx-auto rounded-lg shadow-lg overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #059669 0%, #047857 100%)'
        }}
      >
        <div className="flex items-center justify-between p-4 gap-4">
          {/* Icon and Message */}
          <div className="flex items-center gap-3 flex-1">
            <div className="bg-white bg-opacity-20 p-2.5 rounded-lg">
              <FaMapMarkerAlt className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm md:text-base">
                {permissionState === 'denied' ? 'Location Access Blocked' : 'Enable Location Access'}
              </h3>
              <p className="text-white text-opacity-90 text-xs md:text-sm">
                {permissionState === 'denied' 
                  ? 'Please enable location in your browser settings to use attendance features'
                  : 'Required for attendance check-in/check-out and geofencing features'
                }
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {permissionState !== 'denied' && (
              <button
                onClick={handleEnable}
                className="bg-white text-green-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-opacity-90 transition-all"
              >
                Enable
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="text-white hover:bg-white hover:bg-opacity-10 p-2 rounded-lg transition-all"
              title="Dismiss"
            >
              <FaTimes className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

