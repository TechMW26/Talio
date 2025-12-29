// Cache management utilities

/**
 * Check if running in Electron/desktop app environment
 * Multiple detection methods for reliability
 */
function isDesktopApp() {
  if (typeof window === 'undefined') return false
  
  // Method 1: Check talioDesktop API from preload
  if (window.talioDesktop?.isDesktopApp) return true
  
  // Method 2: Check user agent for Electron
  if (navigator.userAgent.toLowerCase().includes('electron')) return true
  
  // Method 3: Check for Electron-specific objects
  if (window.process?.type === 'renderer') return true
  
  // Method 4: Check if window.require exists (Electron context)
  if (typeof window.require === 'function') return true
  
  return false
}

export const clearAllCache = () => {
  // CRITICAL: Don't clear cache or reload in desktop app - causes white screen
  if (isDesktopApp()) {
    console.log('[Cache] Desktop app detected, skipping cache clear and reload')
    return
  }
  
  try {
    // Clear localStorage except for essential items
    const essentialKeys = ['token', 'user']
    const allKeys = Object.keys(localStorage)
    
    allKeys.forEach(key => {
      if (!essentialKeys.includes(key)) {
        localStorage.removeItem(key)
      }
    })

    // Clear sessionStorage
    sessionStorage.clear()

    // Force reload without cache
    if (typeof window !== 'undefined') {
      window.location.reload(true)
    }
  } catch (error) {
    console.error('Error clearing cache:', error)
  }
}

export const clearTaskCache = () => {
  try {
    const taskKeys = Object.keys(localStorage).filter(key => 
      key.startsWith('task_') || 
      key.startsWith('tasks_') ||
      key.includes('dashboard')
    )
    
    taskKeys.forEach(key => {
      localStorage.removeItem(key)
    })
  } catch (error) {
    console.error('Error clearing task cache:', error)
  }
}

export const addCacheBuster = (url) => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_t=${Date.now()}`
}

export const getWithCacheBuster = async (url, options = {}) => {
  const busteredUrl = addCacheBuster(url)
  return fetch(busteredUrl, {
    ...options,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...options.headers
    }
  })
}
