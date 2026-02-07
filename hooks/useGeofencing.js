'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/utils/toast'
import { handleSessionExpired } from '@/utils/userHelper'
import { getCurrentISTDate, getCurrentISTMinutesSinceMidnight, getCurrentISTDayName } from '@/lib/timezone'

export default function useGeofencing() {
  const [isTracking, setIsTracking] = useState(false)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [geofenceSettings, setGeofenceSettings] = useState(null)
  const [isWithinGeofence, setIsWithinGeofence] = useState(true)
  const [lastCheckTime, setLastCheckTime] = useState(null)
  const [watchId, setWatchId] = useState(null)

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

    return R * c // Distance in meters
  }

  // Check if current time is during work hours (IST)
  const isDuringWorkHours = (checkInTime, checkOutTime) => {
    if (!checkInTime || !checkOutTime) return false

    const currentTime = getCurrentISTMinutesSinceMidnight()

    const [checkInHour, checkInMin] = checkInTime.split(':').map(Number)
    const [checkOutHour, checkOutMin] = checkOutTime.split(':').map(Number)

    const checkInMinutes = checkInHour * 60 + checkInMin
    const checkOutMinutes = checkOutHour * 60 + checkOutMin

    return currentTime >= checkInMinutes && currentTime <= checkOutMinutes
  }

  // Check if current time is during break time (IST)
  const isDuringBreakTime = (breakTimings) => {
    if (!breakTimings || breakTimings.length === 0) return false

    const currentTime = getCurrentISTMinutesSinceMidnight()
    const currentDay = getCurrentISTDayName()

    for (const breakTiming of breakTimings) {
      if (!breakTiming.isActive) continue

      // Check if today is in the break timing's days
      if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(currentDay)) {
        continue
      }

      const [startHour, startMin] = breakTiming.startTime.split(':').map(Number)
      const [endHour, endMin] = breakTiming.endTime.split(':').map(Number)

      const startMinutes = startHour * 60 + startMin
      const endMinutes = endHour * 60 + endMin

      if (currentTime >= startMinutes && currentTime <= endMinutes) {
        return true
      }
    }

    return false
  }

  // Fetch geofence settings
  const fetchGeofenceSettings = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/settings/company', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired()
        return null
      }
      
      const data = await response.json()
      if (data.success && data.data.geofence) {
        setGeofenceSettings(data.data)
        return data.data
      }
    } catch (error) {
      console.error('Error fetching geofence settings:', error)
    }
    return null
  }, [])

  // Log location to server
  const logLocation = useCallback(async (position, eventType = 'location_update', reason = null) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/geofence/log', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          eventType,
          reason
        })
      })

      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired()
        return null
      }

      const data = await response.json()
      if (data.success) {
        setIsWithinGeofence(data.data.isWithinGeofence)
        return data.data
      }
    } catch (error) {
      console.error('Error logging location:', error)
    }
    return null
  }, [])

  // Handle location update
  const handleLocationUpdate = useCallback(async (position) => {
    setCurrentLocation({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date(position.timestamp)
    })

    if (!geofenceSettings || !geofenceSettings.geofence.enabled) {
      return
    }

    const duringWorkHours = isDuringWorkHours(
      geofenceSettings.checkInTime,
      geofenceSettings.checkOutTime
    )

    // Check if during break time - skip geofencing if true
    const duringBreak = isDuringBreakTime(geofenceSettings.breakTimings)
    if (duringBreak) {
      return // Don't track during break times
    }

    // The API will handle checking multiple locations
    // We just need to log the location and get the response
    const now = getCurrentISTDate().getTime()
    const shouldLog = !lastCheckTime || (now - lastCheckTime) > 15 * 60 * 1000 // Every 15 minutes

    if (shouldLog || !isWithinGeofence) {
      const eventType = 'location_update'
      const logData = await logLocation(position, eventType)

      setLastCheckTime(now)

      if (logData) {
        const wasWithinGeofence = isWithinGeofence
        const nowWithinGeofence = logData.isWithinGeofence
        const statusChanged = wasWithinGeofence !== nowWithinGeofence

        setIsWithinGeofence(nowWithinGeofence)

        // If outside geofence during work hours and requires approval
        if (!nowWithinGeofence && duringWorkHours && logData.requiresApproval && statusChanged) {
          // Show popup asking for reason
          showOutOfPremisesPopup(position)
        } else if (!nowWithinGeofence && duringWorkHours && geofenceSettings.geofence.notifyOnExit && statusChanged) {
          // Just notify
          const locationMsg = logData.locationName ? ` (Closest: ${logData.locationName})` : ''
          toast.error(`You are outside the office premises during work hours${locationMsg}`, {
            duration: 5000,
            icon: '📍'
          })
        }
      }
    }
  }, [geofenceSettings, isWithinGeofence, lastCheckTime, logLocation])

  // Show popup for out-of-premises reason
  const showOutOfPremisesPopup = useCallback((position) => {
    // This will be handled by a separate component
    // Dispatch custom event that the component can listen to
    const event = new CustomEvent('geofence-exit', {
      detail: { position }
    })
    window.dispatchEvent(event)
  }, [])

  // Start tracking
  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return
    }

    // Fetch settings first
    const settings = await fetchGeofenceSettings()
    if (!settings || !settings.geofence.enabled) {
      console.log('Geofencing is not enabled')
      return
    }

    // Request permission and start watching
    const id = navigator.geolocation.watchPosition(
      handleLocationUpdate,
      (error) => {
        console.error('Geolocation error:', error)
        if (error.code === error.PERMISSION_DENIED) {
          toast.error('Location permission denied. Please enable location access.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000 // Cache for 1 minute
      }
    )

    setWatchId(id)
    setIsTracking(true)
  }, [fetchGeofenceSettings, handleLocationUpdate])

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      setWatchId(null)
      setIsTracking(false)
    }
  }, [watchId])

  // Auto-start tracking on mount
  useEffect(() => {
    startTracking()
    return () => stopTracking()
  }, [])

  return {
    isTracking,
    currentLocation,
    isWithinGeofence,
    geofenceSettings,
    startTracking,
    stopTracking,
    logLocation
  }
}

