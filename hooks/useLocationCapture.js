'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Custom hook for capturing high-accuracy GPS location
 * Used for attendance check-in/check-out
 * 
 * Features:
 * - High accuracy GPS
 * - Permission handling
 * - Error state management
 * - Loading state
 */
export default function useLocationCapture() {
    const [location, setLocation] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [permissionStatus, setPermissionStatus] = useState(null)
    const watchIdRef = useRef(null)
    const permissionRef = useRef(null)
    const permissionListenerRef = useRef(null)

    /**
     * Check if geolocation is supported
     */
    const isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator

    /**
     * Check current permission status
     */
    const checkPermission = useCallback(async () => {
        if (!isSupported) {
            setPermissionStatus('unsupported')
            return 'unsupported'
        }

        try {
            // Check permission status if Permission API is available
            if (navigator.permissions) {
                const result = await navigator.permissions.query({ name: 'geolocation' })
                setPermissionStatus(result.state)

                if (permissionRef.current !== result) {
                    if (permissionRef.current && permissionListenerRef.current) {
                        permissionRef.current.removeEventListener?.('change', permissionListenerRef.current)
                    }
                    const listener = () => setPermissionStatus(result.state)
                    result.addEventListener('change', listener)
                    permissionRef.current = result
                    permissionListenerRef.current = listener
                }

                return result.state
            }

            // Fallback: permission status unknown
            setPermissionStatus('prompt')
            return 'prompt'
        } catch (err) {
            console.warn('Permission check error:', err)
            setPermissionStatus('prompt')
            return 'prompt'
        }
    }, [isSupported])

    /**
     * Capture current location with high accuracy
     * Returns location data or throws error
     */
    const captureLocation = useCallback(async ({ maxAccuracyMeters = null, requireAccurate = false } = {}) => {
        if (!isSupported) {
            const errorMsg = 'Geolocation is not supported by this browser/device'
            setError(errorMsg)
            const unsupportedError = new Error(errorMsg)
            unsupportedError.name = 'LocationError'
            throw unsupportedError
        }

        setLoading(true)
        setError(null)

        return new Promise((resolve, reject) => {
            const options = {
                enableHighAccuracy: true,  // Use GPS for high accuracy
                timeout: 15000,            // 15 second timeout
                maximumAge: 0              // Don't use cached position
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const locationData = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        altitude: position.coords.altitude,
                        altitudeAccuracy: position.coords.altitudeAccuracy,
                        heading: position.coords.heading,
                        speed: position.coords.speed,
                        timestamp: position.timestamp,
                        capturedAt: new Date().toISOString()
                    }

                    if (requireAccurate && Number.isFinite(Number(maxAccuracyMeters)) &&
                        Number.isFinite(Number(locationData.accuracy)) &&
                        Number(locationData.accuracy) > Number(maxAccuracyMeters)) {
                        const errorMessage = `Location accuracy is ${Math.round(locationData.accuracy)}m. Required accuracy is ${maxAccuracyMeters}m or better.`
                        setLoading(false)
                        setError(errorMessage)
                        const accuracyError = new Error(errorMessage)
                        accuracyError.name = 'LocationError'
                        reject(accuracyError)
                        return
                    }

                    setLocation(locationData)
                    setLoading(false)
                    setError(null)
                    setPermissionStatus('granted')

                    console.log(`📍 Location captured: ${locationData.latitude}, ${locationData.longitude} (accuracy: ${locationData.accuracy}m)`)

                    resolve(locationData)
                },
                (geoError) => {
                    setLoading(false)

                    let errorMessage = 'Unable to get location'
                    let errorCode = geoError.code

                    switch (geoError.code) {
                        case geoError.PERMISSION_DENIED:
                            errorMessage = 'Location permission denied. Please enable location services in your browser/device settings to mark attendance.'
                            setPermissionStatus('denied')
                            break
                        case geoError.POSITION_UNAVAILABLE:
                            errorMessage = 'Location information is unavailable. Please ensure GPS is enabled and try again.'
                            break
                        case geoError.TIMEOUT:
                            errorMessage = 'Location request timed out. Please try again in an area with better GPS signal.'
                            break
                        default:
                            errorMessage = `Location error: ${geoError.message}`
                    }

                    setError(errorMessage)
                    console.error(`❌ Location capture failed: ${errorMessage}`)

                    const captureError = new Error(errorMessage)
                    captureError.name = 'LocationError'
                    reject(captureError)
                },
                options
            )
        })
    }, [isSupported])

    /**
     * Start watching location (for continuous tracking)
     */
    const startWatching = useCallback((onUpdate, onError) => {
        if (!isSupported) {
            onError?.('Geolocation not supported')
            return
        }

        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current)
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
                const locationData = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                }
                setLocation(locationData)
                onUpdate?.(locationData)
            },
            (geoError) => {
                const errorMsg = getErrorMessage(geoError)
                setError(errorMsg)
                onError?.(errorMsg)
            },
            options
        )

        return watchIdRef.current
    }, [isSupported])

    /**
     * Stop watching location
     */
    const stopWatching = useCallback(() => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
        }
    }, [])

    /**
     * Clear current location and error state
     */
    const clearLocation = useCallback(() => {
        setLocation(null)
        setError(null)
        setLoading(false)
    }, [])

    /**
     * Open device settings (for mobile/desktop apps)
     */
    const openSettings = useCallback(() => {
        // This is platform-specific
        // On web, we can't directly open settings
        // But we can provide guidance
        if (typeof window !== 'undefined' && window.electron) {
            // Desktop app - send IPC message
            window.electron.openLocationSettings?.()
        }
        // On web, just log guidance
        console.log('Please enable location in your browser settings')
    }, [])

    useEffect(() => {
        checkPermission()
        return () => {
            if (watchIdRef.current !== null && isSupported) {
                navigator.geolocation.clearWatch(watchIdRef.current)
            }
            if (permissionRef.current && permissionListenerRef.current) {
                permissionRef.current.removeEventListener?.('change', permissionListenerRef.current)
            }
        }
    }, [checkPermission, isSupported])

    return {
        // State
        location,
        loading,
        error,
        permissionStatus,
        isSupported,

        // Actions
        captureLocation,
        checkPermission,
        startWatching,
        stopWatching,
        clearLocation,
        openSettings,

        // Derived state
        hasPermission: permissionStatus === 'granted',
        isDenied: permissionStatus === 'denied',
        isPrompt: permissionStatus === 'prompt' || permissionStatus === null
    }
}

// Helper function to get user-friendly error messages
function getErrorMessage(geoError) {
    switch (geoError.code) {
        case 1: // PERMISSION_DENIED
            return 'Location permission denied. Please enable location services.'
        case 2: // POSITION_UNAVAILABLE
            return 'Location unavailable. Please check your GPS settings.'
        case 3: // TIMEOUT
            return 'Location request timed out. Please try again.'
        default:
            return `Location error: ${geoError.message}`
    }
}
