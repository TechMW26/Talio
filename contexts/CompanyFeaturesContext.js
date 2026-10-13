'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSocket } from '@/contexts/SocketContext'
import { isFeatureEnabled as checkFeatureEnabled, mergeCompanyFeatures } from '@/lib/planFeatures'

const CompanyFeaturesContext = createContext(null)

function getStorageKey(databaseName) {
  return `talio_company_features_${databaseName}`
}

function readCachedPayload(databaseName) {
  if (typeof window === 'undefined' || !databaseName) return null

  try {
    const raw = localStorage.getItem(getStorageKey(databaseName))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeCachedPayload(databaseName, payload) {
  if (typeof window === 'undefined' || !databaseName || !payload) return

  try {
    localStorage.setItem(getStorageKey(databaseName), JSON.stringify({
      ...payload,
      cachedAt: Date.now(),
    }))
  } catch {
    // Ignore storage write failures
  }
}

export function CompanyFeaturesProvider({ children }) {
  const { subscribe } = useSocket()
  const inFlightRefreshRef = useRef(null)
  const [state, setState] = useState({
    databaseName: null,
    plan: 'custom',
    features: null,
    miraAccess: null,
    miraTokens: { perUserAllocation: 0 },
    updatedAt: null,
    loading: true,
  })

  const refreshFeatures = useCallback(async (databaseNameOverride = null) => {
    const userData = localStorage.getItem('user')
    const token = localStorage.getItem('token')

    if (!userData || !token) {
      setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
      return null
    }

    let parsedUser = null
    try {
      parsedUser = JSON.parse(userData)
    } catch {
      setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
      return null
    }

    const databaseName = databaseNameOverride || parsedUser?.tenant?.databaseName || parsedUser?.databaseName || null
    if (!databaseName) {
      setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
      return null
    }

    if (inFlightRefreshRef.current?.databaseName === databaseName && inFlightRefreshRef.current.token === token) {
      return inFlightRefreshRef.current.promise
    }

    const refreshPromise = (async () => {
      try {
        const response = await fetch('/api/company/features', {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch company features (${response.status})`)
        }

        const data = await response.json()
        // An old account's late response must not grant a newly signed-in user.
        if (localStorage.getItem('token') !== token) return null
        if (!data.success) {
          throw new Error(data.message || 'Failed to fetch company features')
        }

        const nextPayload = {
          databaseName,
          plan: data.plan || 'custom',
          features: mergeCompanyFeatures(data.features, data.plan || 'custom'),
          miraAccess: data.miraAccess || { allowed: false },
          miraTokens: data.miraTokens || { perUserAllocation: 0 },
          updatedAt: data.updatedAt || new Date().toISOString(),
        }

        writeCachedPayload(databaseName, nextPayload)
        setState({ ...nextPayload, loading: false })
        return nextPayload
      } catch (error) {
        console.error('[CompanyFeaturesContext] Failed to refresh company features:', error)
        setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
        return null
      } finally {
        if (inFlightRefreshRef.current?.promise === refreshPromise) {
          inFlightRefreshRef.current = null
        }
      }
    })()

    inFlightRefreshRef.current = { databaseName, token, promise: refreshPromise }
    return refreshPromise
  }, [])

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (!userData) {
      setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
      return
    }

    try {
      const parsedUser = JSON.parse(userData)
      const databaseName = parsedUser?.tenant?.databaseName || parsedUser?.databaseName || null
      if (!databaseName) {
        setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
        return
      }

      const cachedPayload = readCachedPayload(databaseName)
      if (cachedPayload?.features) {
        // Cached tenant flags must never grant a new user's Mira permissions.
        setState({ ...cachedPayload, miraAccess: null, databaseName, loading: true })
      } else {
        setState((prev) => ({ ...prev, databaseName, loading: true }))
      }

      refreshFeatures(databaseName)
    } catch {
      setState((prev) => ({ ...prev, miraAccess: null, loading: false }))
    }
  }, [refreshFeatures])

  useEffect(() => {
    if (!state.databaseName) return undefined

    const unsubscribe = subscribe('company-features-updated', (payload) => {
      if (!payload?.databaseName || payload.databaseName !== state.databaseName) {
        return
      }

      const nextPayload = {
        databaseName: payload.databaseName,
        plan: payload.plan || 'custom',
        features: mergeCompanyFeatures(payload.features, payload.plan || 'custom'),
        miraTokens: payload.miraTokens || { perUserAllocation: 0 },
        updatedAt: payload.updatedAt || new Date().toISOString(),
      }

      writeCachedPayload(payload.databaseName, nextPayload)
      setState(prev => ({ ...nextPayload, miraAccess: prev.miraAccess, loading: false }))
      refreshFeatures(state.databaseName)
    })

    return unsubscribe
  }, [state.databaseName, subscribe, refreshFeatures])

  useEffect(() => {
    if (!state.databaseName) return undefined

    return subscribe('mira-access-updated', () => {
      // Stop mic owners immediately while fetching fresh per-user permission.
      setState(prev => ({ ...prev, miraAccess: null }))
      refreshFeatures(state.databaseName)
    })
  }, [state.databaseName, subscribe, refreshFeatures])

  useEffect(() => {
    if (!state.databaseName) return undefined

    const handleFocus = () => {
      refreshFeatures(state.databaseName)
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('mira:access-changed', handleFocus)
    return () => { window.removeEventListener('focus', handleFocus); window.removeEventListener('mira:access-changed', handleFocus) }
  }, [refreshFeatures, state.databaseName])

  const isFeatureEnabled = useCallback(
    (featureKey) => checkFeatureEnabled(state.features, featureKey),
    [state.features]
  )

  const value = useMemo(() => ({
    ...state,
    refreshFeatures,
    isFeatureEnabled,
  }), [state, refreshFeatures, isFeatureEnabled])

  return (
    <CompanyFeaturesContext.Provider value={value}>
      {children}
    </CompanyFeaturesContext.Provider>
  )
}

export function useCompanyFeatures() {
  const context = useContext(CompanyFeaturesContext)

  if (!context) {
    throw new Error('useCompanyFeatures must be used within a CompanyFeaturesProvider')
  }

  return context
}
