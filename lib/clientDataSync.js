'use client'

import { mutate } from 'swr'

const DATA_CHANGE_STORAGE_KEY = 'talio:data-change'
const DATA_CHANGE_EVENT = 'talio:data-change'
const FORCE_FRESH_WINDOW_MS = 5000

let revalidateTimer = null

function parseStoredChange(rawValue) {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue)
    if (typeof parsed?.forceFreshUntil === 'number') {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

function getCurrentChangeState() {
  if (typeof window === 'undefined') return null

  return parseStoredChange(window.localStorage.getItem(DATA_CHANGE_STORAGE_KEY))
}

function isInternalApiUrl(urlValue) {
  if (typeof window === 'undefined' || !urlValue) return false

  try {
    const resolvedUrl = new URL(urlValue, window.location.origin)
    return resolvedUrl.origin === window.location.origin && resolvedUrl.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function getRequestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return ''
}

function getRequestMethod(input, init) {
  const method = init?.method || (input instanceof Request ? input.method : 'GET')
  return (method || 'GET').toUpperCase()
}

function isMutationMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
}

function mergeHeaders(input, init) {
  const mergedHeaders = new Headers(input instanceof Request ? input.headers : undefined)
  const initHeaders = new Headers(init?.headers || undefined)

  initHeaders.forEach((value, key) => {
    mergedHeaders.set(key, value)
  })

  return mergedHeaders
}

function scheduleApiRevalidation() {
  if (typeof window === 'undefined' || revalidateTimer) return

  revalidateTimer = window.setTimeout(() => {
    revalidateTimer = null

    mutate(
      key => {
        if (typeof key === 'string') {
          return key.startsWith('/api/')
        }

        if (Array.isArray(key) && typeof key[0] === 'string') {
          return key[0].startsWith('/api/')
        }

        return false
      },
      undefined,
      { revalidate: true }
    ).catch(error => {
      console.warn('[clientDataSync] Failed to revalidate API queries:', error)
    })
  }, 25)
}

async function notifySuccessfulMutation(response, source) {
  const contentType = response.headers.get('content-type') || ''

  if (!contentType.includes('application/json')) {
    markClientDataChanged(source)
    return
  }

  try {
    const data = await response.clone().json()
    if (data?.success === false) return
  } catch {
    // Non-JSON or empty responses still represent a successful mutation.
  }

  markClientDataChanged(source)
}

function prepareFetchArgs(input, init) {
  const url = getRequestUrl(input)
  const method = getRequestMethod(input, init)
  const internalApiRequest = isInternalApiUrl(url)

  if (!internalApiRequest) {
    return {
      input,
      init,
      method,
      internalApiRequest,
      url,
    }
  }

  const headers = mergeHeaders(input, init)
  const nextInit = { ...init, headers }

  if (!isMutationMethod(method) && shouldForceFreshRequest()) {
    headers.set('x-talio-force-fresh', '1')
    nextInit.cache = 'no-store'
  }

  if (input instanceof Request) {
    return {
      input: new Request(input, nextInit),
      init: undefined,
      method,
      internalApiRequest,
      url,
    }
  }

  return {
    input: url,
    init: nextInit,
    method,
    internalApiRequest,
    url,
  }
}

export function shouldForceFreshRequest() {
  const state = getCurrentChangeState()
  return Boolean(state?.forceFreshUntil && state.forceFreshUntil > Date.now())
}

export function markClientDataChanged(source = 'mutation') {
  if (typeof window === 'undefined') return

  const payload = {
    source,
    changedAt: Date.now(),
    forceFreshUntil: Date.now() + FORCE_FRESH_WINDOW_MS,
    nonce: Math.random().toString(36).slice(2),
  }

  try {
    window.localStorage.setItem(DATA_CHANGE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures (Safari private mode, quota, etc.)
  }

  window.dispatchEvent(new CustomEvent(DATA_CHANGE_EVENT, { detail: payload }))
  scheduleApiRevalidation()
}

export function revalidateAllApiQueries() {
  scheduleApiRevalidation()
}

export function subscribeToClientDataChanges(callback) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleCustomEvent = event => {
    callback?.(event.detail)
  }

  const handleStorageEvent = event => {
    if (event.key !== DATA_CHANGE_STORAGE_KEY || !event.newValue) return

    const nextState = parseStoredChange(event.newValue)
    if (nextState) {
      callback?.(nextState)
    }
  }

  window.addEventListener(DATA_CHANGE_EVENT, handleCustomEvent)
  window.addEventListener('storage', handleStorageEvent)

  return () => {
    window.removeEventListener(DATA_CHANGE_EVENT, handleCustomEvent)
    window.removeEventListener('storage', handleStorageEvent)
  }
}

export function patchBrowserFetchForFreshness() {
  if (typeof window === 'undefined') {
    return () => {}
  }

  if (window.__talioFreshnessRestoreFetch) {
    return window.__talioFreshnessRestoreFetch
  }

  const originalFetch = window.fetch.bind(window)

  const restoreFetch = () => {
    if (window.__talioOriginalFetch) {
      window.fetch = window.__talioOriginalFetch
    }

    delete window.__talioOriginalFetch
    delete window.__talioFreshnessRestoreFetch
  }

  window.__talioOriginalFetch = originalFetch
  window.__talioFreshnessRestoreFetch = restoreFetch

  window.fetch = async (input, init) => {
    const request = prepareFetchArgs(input, init)
    const response = await originalFetch(request.input, request.init)

    if (request.internalApiRequest && isMutationMethod(request.method) && response.ok) {
      notifySuccessfulMutation(response, `${request.method} ${request.url}`).catch(error => {
        console.warn('[clientDataSync] Failed to process mutation freshness:', error)
      })
    }

    return response
  }

  return restoreFetch
}