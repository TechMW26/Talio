/**
 * Talio Network Monitor Script v1.0.0
 * 
 * This script is downloaded by the desktop app and runs in the background
 * to detect when internet connectivity is restored. It automatically reloads
 * the app when connection is available.
 * 
 * Features:
 * - Polls server every 3 seconds while offline
 * - Stores last visited URL for restoration
 * - Shows visual countdown before reload
 * - Works with both Electron offline page and Next.js /offline page
 * 
 * NOTE: This script is DISABLED when running in the Electron desktop app
 * since the desktop app has its own offline.html page with built-in handling.
 */

(function() {
  'use strict';

  // Skip if running in Electron desktop app with its own offline handling
  if (window.isElectron === true || window.electronAPI !== undefined) {
    console.log('[NetworkMonitor] Desktop app detected - using Electron offline page instead');
    return;
  }

  // Prevent multiple initializations
  if (window.__TALIO_NETWORK_MONITOR__) {
    console.log('[NetworkMonitor] Already initialized');
    return;
  }
  window.__TALIO_NETWORK_MONITOR__ = true;

  // Configuration
  const CONFIG = {
    POLL_INTERVAL: 3000,          // 3 seconds
    PING_TIMEOUT: 5000,           // 5 second timeout for ping
    PING_URL: 'https://app.talio.in/api/health',  // Health check endpoint
    FALLBACK_PING_URL: 'https://app.talio.in/manifest.json',
    RELOAD_DELAY: 1500,           // 1.5 second delay before reload (for UI feedback)
    STORAGE_KEY: 'talio_last_url',
    MAX_CONSECUTIVE_FAILURES: 20  // Stop polling after 1 minute of failures (20 * 3s)
  };

  // State
  let pollInterval = null;
  let isPolling = false;
  let consecutiveFailures = 0;
  let statusElement = null;

  /**
   * Get the last URL the user was on before going offline
   */
  function getLastUrl() {
    try {
      const lastUrl = localStorage.getItem(CONFIG.STORAGE_KEY);
      // Default to dashboard if no stored URL or if URL is invalid
      if (!lastUrl || lastUrl.includes('/offline') || lastUrl.startsWith('data:')) {
        return 'https://app.talio.in/dashboard';
      }
      return lastUrl;
    } catch (e) {
      return 'https://app.talio.in/dashboard';
    }
  }

  /**
   * Save the current URL (called when online, before any navigation issues)
   */
  function saveCurrentUrl() {
    try {
      const url = window.location.href;
      // Don't save offline pages or data URLs
      if (!url.includes('/offline') && !url.startsWith('data:') && url.startsWith('https://app.talio.in')) {
        localStorage.setItem(CONFIG.STORAGE_KEY, url);
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Create or update the status UI element
   */
  function createStatusUI() {
    // Remove existing if present
    if (statusElement) {
      statusElement.remove();
    }

    statusElement = document.createElement('div');
    statusElement.id = 'talio-network-status';
    statusElement.innerHTML = `
      <style>
        #talio-network-status {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(30, 30, 50, 0.95);
          backdrop-filter: blur(10px);
          color: white;
          padding: 12px 24px;
          border-radius: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          z-index: 999999;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }
        #talio-network-status.connected {
          background: rgba(34, 197, 94, 0.95);
        }
        #talio-network-status .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: talio-spin 1s linear infinite;
        }
        #talio-network-status .check-icon {
          width: 18px;
          height: 18px;
          display: none;
        }
        #talio-network-status.connected .spinner {
          display: none;
        }
        #talio-network-status.connected .check-icon {
          display: block;
        }
        @keyframes talio-spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="spinner"></div>
      <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="message">Checking connection...</span>
    `;

    document.body.appendChild(statusElement);
    return statusElement;
  }

  /**
   * Update the status message
   */
  function updateStatus(message, isConnected = false) {
    if (!statusElement) {
      statusElement = createStatusUI();
    }
    
    const messageEl = statusElement.querySelector('.message');
    if (messageEl) {
      messageEl.textContent = message;
    }
    
    if (isConnected) {
      statusElement.classList.add('connected');
    } else {
      statusElement.classList.remove('connected');
    }
  }

  /**
   * Ping the server to check connectivity
   */
  async function pingServer() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.PING_TIMEOUT);

    try {
      // Try the health endpoint first
      const response = await fetch(CONFIG.PING_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Try fallback URL
      try {
        const fallbackController = new AbortController();
        const fallbackTimeout = setTimeout(() => fallbackController.abort(), CONFIG.PING_TIMEOUT);
        
        const fallbackResponse = await fetch(CONFIG.FALLBACK_PING_URL, {
          method: 'HEAD',
          cache: 'no-store',
          signal: fallbackController.signal
        });
        
        clearTimeout(fallbackTimeout);
        return fallbackResponse.ok;
      } catch (e) {
        return false;
      }
    }
  }

  /**
   * Handle successful connection
   */
  function handleConnectionRestored() {
    console.log('[NetworkMonitor] Connection restored!');
    stopPolling();
    
    updateStatus('Connection restored! Reloading...', true);
    
    const targetUrl = getLastUrl();
    console.log('[NetworkMonitor] Redirecting to:', targetUrl);
    
    // Small delay for visual feedback
    setTimeout(() => {
      // Use location.replace to avoid adding to history
      window.location.replace(targetUrl);
    }, CONFIG.RELOAD_DELAY);
  }

  /**
   * Poll for connection
   */
  async function poll() {
    if (!isPolling) return;
    
    updateStatus(`Checking connection... (attempt ${consecutiveFailures + 1})`);
    
    const isOnline = await pingServer();
    
    if (isOnline) {
      consecutiveFailures = 0;
      handleConnectionRestored();
    } else {
      consecutiveFailures++;
      
      if (consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        updateStatus('Connection check paused. Click to retry.');
        stopPolling();
        
        // Make status clickable to restart
        if (statusElement) {
          statusElement.style.cursor = 'pointer';
          statusElement.onclick = () => {
            consecutiveFailures = 0;
            startPolling();
          };
        }
      } else {
        updateStatus(`Waiting for connection... (${consecutiveFailures})`);
      }
    }
  }

  /**
   * Start polling for connection
   */
  function startPolling() {
    if (isPolling) return;
    
    console.log('[NetworkMonitor] Starting connection polling');
    isPolling = true;
    
    // Create UI
    createStatusUI();
    updateStatus('Checking connection...');
    
    // Initial check
    poll();
    
    // Start interval
    pollInterval = setInterval(poll, CONFIG.POLL_INTERVAL);
  }

  /**
   * Stop polling
   */
  function stopPolling() {
    console.log('[NetworkMonitor] Stopping connection polling');
    isPolling = false;
    
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  /**
   * Check if we're on an offline page
   */
  function isOfflinePage() {
    const url = window.location.href;
    return url.includes('/offline') || 
           url.startsWith('data:') || 
           document.title.toLowerCase().includes('offline') ||
           document.body.innerHTML.includes('Unable to Connect');
  }

  /**
   * Initialize the network monitor
   */
  function init() {
    console.log('[NetworkMonitor] Initializing Talio Network Monitor v1.0.0');
    
    // If we're on an offline page, start polling
    if (isOfflinePage()) {
      console.log('[NetworkMonitor] Offline page detected, starting monitor');
      startPolling();
    } else {
      // We're online - save current URL for later restoration
      saveCurrentUrl();
      
      // Listen for offline event
      window.addEventListener('offline', () => {
        console.log('[NetworkMonitor] Device went offline');
        // Don't start polling here - the app will navigate to offline page
      });
      
      // Save URL on navigation (for SPAs)
      const originalPushState = history.pushState;
      history.pushState = function() {
        originalPushState.apply(this, arguments);
        saveCurrentUrl();
      };
      
      // Also save on popstate
      window.addEventListener('popstate', saveCurrentUrl);
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also listen for any late offline page transitions
  const observer = new MutationObserver((mutations) => {
    if (isOfflinePage() && !isPolling) {
      console.log('[NetworkMonitor] Offline page detected via DOM change');
      startPolling();
    }
  });
  
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Expose API for manual control
  window.TalioNetworkMonitor = {
    start: startPolling,
    stop: stopPolling,
    check: pingServer,
    getLastUrl: getLastUrl,
    isPolling: () => isPolling
  };

})();
