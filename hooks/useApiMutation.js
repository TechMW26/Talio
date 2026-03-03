'use client'

import { useState, useCallback, useRef } from 'react'
import { mutate } from 'swr'

/**
 * useApiMutation - Professional mutation hook for POST/PUT/DELETE operations
 * 
 * Features:
 * - Loading state per mutation
 * - Double-submit prevention
 * - Optimistic updates with rollback
 * - Automatic SWR cache invalidation
 * - Error handling with retry
 * - Timeout protection
 * 
 * @param {Object} options
 * @param {string} options.method - HTTP method (POST, PUT, DELETE, PATCH)
 * @param {string|string[]} options.invalidateKeys - SWR cache keys to invalidate on success
 * @param {function} options.onSuccess - Callback on success (data) => void
 * @param {function} options.onError - Callback on error (error) => void
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 * @param {Object} options.optimistic - Optimistic update config { key, updater, rollback }
 * 
 * @returns {{ execute, isLoading, error, reset }}
 */
export default function useApiMutation(options = {}) {
  const {
    method = 'POST',
    invalidateKeys = [],
    onSuccess,
    onError,
    timeout = 30000,
    optimistic,
  } = options

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const isSubmittingRef = useRef(false)

  const execute = useCallback(async (url, body, executeOptions = {}) => {
    // Double-submit prevention
    if (isSubmittingRef.current) {
      console.warn('[useApiMutation] Blocked double submission')
      return null
    }

    isSubmittingRef.current = true
    setIsLoading(true)
    setError(null)

    // Setup abort controller for timeout
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // Apply optimistic update
    let rollbackData = null
    const optimisticConfig = executeOptions.optimistic || optimistic
    if (optimisticConfig?.key && optimisticConfig?.updater) {
      try {
        rollbackData = optimisticConfig.rollback
        await mutate(optimisticConfig.key, optimisticConfig.updater, false)
      } catch (e) {
        console.warn('[useApiMutation] Optimistic update failed:', e)
      }
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const headers = {
        'Authorization': `Bearer ${token}`,
      }

      // Don't set Content-Type for FormData (browser sets boundary automatically)
      if (!(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json'
      }

      const response = await fetch(url, {
        method: executeOptions.method || method,
        headers,
        body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Handle 401
      if (response.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.location.href = '/login'
        throw new Error('Session expired')
      }

      const data = await response.json()

      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || 'Operation failed')
      }

      // Invalidate SWR caches
      const keys = executeOptions.invalidateKeys || invalidateKeys
      const keysArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keysArray) {
        if (key) {
          // Support regex key matching for invalidating multiple related caches
          if (key instanceof RegExp) {
            await mutate(
              k => typeof k === 'string' && key.test(k),
              undefined,
              { revalidate: true }
            )
          } else {
            await mutate(key)
          }
        }
      }

      // Call success handler
      const successHandler = executeOptions.onSuccess || onSuccess
      successHandler?.(data)

      setIsLoading(false)
      isSubmittingRef.current = false
      return data

    } catch (err) {
      clearTimeout(timeoutId)

      // Rollback optimistic update on error
      if (rollbackData !== null && optimisticConfig?.key) {
        try {
          await mutate(optimisticConfig.key, rollbackData, false)
        } catch (rollbackErr) {
          console.error('[useApiMutation] Rollback failed:', rollbackErr)
        }
      }

      const errorMessage = err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : err.message || 'An error occurred'

      setError(errorMessage)
      setIsLoading(false)
      isSubmittingRef.current = false

      // Call error handler
      const errorHandler = executeOptions.onError || onError
      errorHandler?.(errorMessage)

      return null
    }
  }, [method, invalidateKeys, onSuccess, onError, timeout, optimistic])

  const reset = useCallback(() => {
    setError(null)
    setIsLoading(false)
    isSubmittingRef.current = false
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }, [])

  return { execute, isLoading, error, reset }
}

/**
 * Simple mutation helper for one-off API calls that don't need the full hook
 * Returns a promise that resolves with the API response data
 * 
 * @param {string} url - API endpoint
 * @param {Object} options - { method, body, invalidateKeys }
 * @returns {Promise<Object>} API response data
 */
export async function apiMutate(url, options = {}) {
  const { method = 'POST', body, invalidateKeys = [], timeout = 30000 } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    const headers = {
      'Authorization': `Bearer ${token}`,
    }

    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
      throw new Error('Session expired')
    }

    const data = await response.json()

    if (!response.ok || data?.success === false) {
      throw new Error(data?.message || 'Operation failed')
    }

    // Invalidate caches
    const keys = Array.isArray(invalidateKeys) ? invalidateKeys : [invalidateKeys]
    for (const key of keys) {
      if (key) await mutate(key)
    }

    return data
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}
