'use client'

import useSWR from 'swr'
import { clearAllSessionCaches } from '@/utils/sessionCache'
import { collectEmployeePages, isCompleteEmployeeList } from '@/lib/client/employeePages'

// Flag to prevent multiple redirects
let isRedirecting = false

/**
 * Reset the redirect flag - call this after successful login
 */
export function resetAuthRedirectFlag() {
  isRedirecting = false
}

/**
 * Handle 401 Unauthorized - redirect to login (deduplicated)
 */
const handle401 = () => {
  if (isRedirecting) return
  isRedirecting = true
  
  console.log('[Auth] Session expired, redirecting to login...')
  
  // Clear all auth data
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  localStorage.removeItem('userId')
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  
  // Clear session cache
  clearAllSessionCaches()
  
  // Reset flag after a delay to handle edge cases
  setTimeout(() => {
    isRedirecting = false
  }, 5000)
  
  // Redirect to login
  window.location.href = '/login'
}

/**
 * Fetch with retry and timeout for network resilience
 */
const fetchWithRetry = async (url, options, maxRetries = 1, timeout = 15000) => {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response
    } catch (error) {
      lastError = error

      // Don't retry on abort or on final attempt
      if (error.name === 'AbortError' || attempt === maxRetries) {
        throw error
      }

      // Exponential backoff: 500ms, 1s
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500))
    }
  }

  throw lastError
}

const authedFetcher = async (url) => {
  if (isCompleteEmployeeList(url)) return collectEmployeePages(url, authedFetcher)
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined

  try {
    const response = await fetchWithRetry(url, { headers })
    
    // Handle 401 Unauthorized - session expired
    if (response.status === 401) {
      handle401()
      throw new Error('Session expired')
    }
    
    const data = await response.json()

    if (!response.ok || data?.success === false) {
      const message = data?.message || 'Failed to fetch data'
      throw new Error(message)
    }

    return data
  } catch (error) {
    // On network timeout, throw with better message
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection.')
    }
    throw error
  }
}

export default function useAuthedSWR(key, options = {}) {
  const result = useSWR(key, authedFetcher, {
    // Stale-while-revalidate: show cached data immediately
    revalidateOnFocus: true,
    revalidateOnMount: true,
    revalidateOnReconnect: true,
    // Coalesce duplicate mounts and realtime bursts. Explicit mutate calls are
    // still immediate, so this does not delay post-mutation updates.
    dedupingInterval: 5000,
    // Don't retry on error by default (we have retry in fetcher)
    shouldRetryOnError: false,
    // Keep previous data while loading new data (prevents flashing)
    keepPreviousData: true,
    // Error retry interval
    errorRetryInterval: 5000,
    errorRetryCount: 2,
    // Suspense disabled for faster initial render
    suspense: false,
    ...options,
  })
  // SWR marks fallback/previous data as loading. Keep that data visible while
  // isValidating reports the background request instead of showing a skeleton.
  return { ...result, isLoading: result.isLoading && result.data === undefined }
}

/**
 * Same as useAuthedSWR but with more aggressive caching for static data
 * Use for data that rarely changes (e.g., departments, designations)
 */
export function useAuthedSWRStatic(key, options = {}) {
  return useAuthedSWR(key, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    revalidateIfStale: true,
    dedupingInterval: 5000,
    shouldRetryOnError: false,
    keepPreviousData: true,
    ...options,
  })
}

/**
 * Same as useAuthedSWR but for real-time data
 * Use for data that needs to be always fresh (e.g., notifications, chat)
 */
export function useAuthedSWRRealtime(key, options = {}) {
  return useAuthedSWR(key, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    // Realtime screens are event-driven. Callers may opt into polling only for
    // protocols that require a liveness check (for example meeting sessions).
    refreshInterval: options.refreshInterval ?? 0,
    dedupingInterval: 5000,
    shouldRetryOnError: true,
    keepPreviousData: true,
    ...options,
  })
}
