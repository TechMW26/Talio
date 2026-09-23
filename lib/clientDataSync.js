'use client'

import { mutate } from 'swr'

const DATA_CHANGE_STORAGE_KEY = 'talio:data-change'
const DATA_CHANGE_EVENT = 'talio:data-change'
const FORCE_FRESH_WINDOW_MS = 5000
const REVALIDATION_DEBOUNCE_MS = 250
const ALL_API_SCOPES = '*'

const REALTIME_SCOPE_RULES = [
  { prefixes: ['attendance-'], scopes: ['/api/attendance', '/api/dashboard'] },
  { prefixes: ['leave-'], scopes: ['/api/leave', '/api/dashboard'] },
  { prefixes: ['expense-'], scopes: ['/api/expenses', '/api/dashboard'] },
  { prefixes: ['travel-'], scopes: ['/api/travel', '/api/dashboard'] },
  { prefixes: ['project-', 'task-'], scopes: ['/api/projects', '/api/tasks', '/api/dashboard'] },
  { prefixes: ['employee-', 'department-'], scopes: ['/api/employees', '/api/directory', '/api/departments', '/api/dashboard'] },
  { prefixes: ['announcement-'], scopes: ['/api/announcements', '/api/dashboard'] },
  { prefixes: ['new-notification'], scopes: ['/api/notifications'] },
  { prefixes: ['geofence-'], scopes: ['/api/geofence', '/api/attendance'] },
  { prefixes: ['performance-'], scopes: ['/api/performance', '/api/dashboard'] },
  { prefixes: ['helpdesk-'], scopes: ['/api/helpdesk', '/api/notifications'] },
  { prefixes: ['document-'], scopes: ['/api/documents'] },
  { prefixes: ['asset-'], scopes: ['/api/assets'] },
  { prefixes: ['payroll-'], scopes: ['/api/payroll'] },
  { prefixes: ['meeting-'], scopes: ['/api/meetings'] },
  { prefixes: ['daily-goal-'], scopes: ['/api/daily-goals', '/api/dashboard'] },
  { prefixes: ['recruitment-'], scopes: ['/api/recruitment'] },
  { prefixes: ['holiday-'], scopes: ['/api/holidays', '/api/leave'] },
  { prefixes: ['policy-'], scopes: ['/api/policies'] },
  { prefixes: ['dashboard-refresh'], scopes: ['/api/dashboard'] },
]

let revalidateTimer = null
const pendingRevalidateMutators = new Set()
const pendingRevalidateScopes = new Set()

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

function normalizeApiPath(value) {
  if (!value || typeof value !== 'string') return ''

  try {
    const base = typeof window === 'undefined' ? 'http://talio.local' : window.location.origin
    return new URL(value, base).pathname.replace(/\/$/, '') || '/'
  } catch {
    return value.split('?')[0].replace(/\/$/, '')
  }
}

function getMutationScope(source) {
  const match = String(source).match(/^[A-Z]+\s+(.+)$/)
  if (!match) return []

  const path = normalizeApiPath(match[1])
  if (!path.startsWith('/api/')) return []
  // These POSTs compute a response; they do not edit the surrounding page data.
  if (new Set([
    '/api/projects/summary-ai', '/api/mail/compose-ai',
    '/api/ai/generate-text', '/api/ai/loading-words', '/api/ai/assistant',
    '/api/ai/mira-chat', '/api/user/heartbeat',
  ]).has(path)) return []

  const [, , domain] = path.split('/')
  if (domain === 'employees' || domain === 'departments') return [`/api/${domain}`, '/api/directory', '/api/dashboard']
  return domain ? [`/api/${domain}`] : []
}

export function getRefreshScopes(source = '') {
  const normalizedSource = String(source)

  if (normalizedSource.startsWith('realtime:')) {
    const eventName = normalizedSource.slice('realtime:'.length)
    const rule = REALTIME_SCOPE_RULES.find(({ prefixes }) =>
      prefixes.some(prefix => eventName === prefix || eventName.startsWith(prefix))
    )
    return rule?.scopes || []
  }

  if (normalizedSource === 'session-permissions-updated') {
    return ['/api/auth', '/api/user', '/api/dashboard']
  }

  return getMutationScope(normalizedSource)
}

export function matchesApiRefreshScope(key, scopes) {
  const keyValue = Array.isArray(key) ? key[0] : key
  if (typeof keyValue !== 'string') return false

  const path = normalizeApiPath(keyValue)
  if (!path.startsWith('/api/')) return false
  // An open editor owns unsaved canvas/viewport state. Mutations update the
  // board list, not the editor snapshot; explicit editor Retry still works.
  if (/^\/api\/whiteboard\/[^/]+$/.test(path)) return false
  if (!Array.isArray(scopes) || scopes.includes(ALL_API_SCOPES)) return true

  return scopes.some(scope => {
    const normalizedScope = normalizeApiPath(scope)
    return path === normalizedScope || path.startsWith(`${normalizedScope}/`)
  })
}

function mergeHeaders(input, init) {
  const mergedHeaders = new Headers(input instanceof Request ? input.headers : undefined)
  const initHeaders = new Headers(init?.headers || undefined)

  initHeaders.forEach((value, key) => {
    mergedHeaders.set(key, value)
  })

  return mergedHeaders
}

function scheduleApiRevalidation(mutateFunction = mutate, scopes = null) {
  if (typeof window === 'undefined') return
  pendingRevalidateMutators.add(mutateFunction)
  if (!Array.isArray(scopes)) {
    pendingRevalidateScopes.add(ALL_API_SCOPES)
  } else {
    scopes.forEach(scope => pendingRevalidateScopes.add(scope))
  }
  if (revalidateTimer) return

  revalidateTimer = window.setTimeout(() => {
    revalidateTimer = null
    const mutators = [...pendingRevalidateMutators]
    const activeScopes = [...pendingRevalidateScopes]
    pendingRevalidateMutators.clear()
    pendingRevalidateScopes.clear()

    if (activeScopes.length === 0) return

    for (const activeMutate of mutators) {
      activeMutate(
        key => matchesApiRefreshScope(key, activeScopes),
        undefined,
        { revalidate: true, populateCache: false }
      ).catch(error => {
        console.warn('[clientDataSync] Failed to revalidate API queries:', error)
      })
    }
  }, REVALIDATION_DEBOUNCE_MS)
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

  if (!isMutationMethod(method) && shouldForceFreshRequest(url)) {
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

export function shouldForceFreshRequest(urlValue) {
  const state = getCurrentChangeState()
  if (!state?.forceFreshUntil || state.forceFreshUntil <= Date.now()) return false

  // Keep backwards compatibility for callers that only need to inspect the
  // freshness window. Actual fetches always provide a URL and only bypass the
  // server cache for the API domain changed by the mutation/realtime event.
  if (!urlValue) return true
  return matchesApiRefreshScope(urlValue, state.scopes)
}

export function markClientDataChanged(source = 'mutation', requestedScopes) {
  if (typeof window === 'undefined') return

  const scopes = Array.isArray(requestedScopes) ? requestedScopes : getRefreshScopes(source)
  if (!scopes.length) return

  const payload = {
    source,
    scopes,
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
}

export function revalidateApiQueries(mutateFunction = mutate, scopes = null) {
  scheduleApiRevalidation(mutateFunction, scopes)
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
