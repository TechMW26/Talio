const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script
 * Exposes safe APIs to the renderer process for:
 * - Authentication token management
 * - Screen capture control
 * - Session management
 * - Role-based restrictions
 * - Platform detection
 */

// Expose Talio Desktop API to renderer
contextBridge.exposeInMainWorld('talioDesktop', {
  // Check if running in desktop app
  isDesktopApp: true,
  
  // Get platform (darwin, win32, linux)
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  
  // Auth token management
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  
  // User ID management
  getUserId: () => ipcRenderer.invoke('get-user-id'),
  setUserId: (userId) => ipcRenderer.invoke('set-user-id', userId),
  
  // User role management
  getUserRole: () => ipcRenderer.invoke('get-user-role'),
  setUserRole: (role) => ipcRenderer.invoke('set-user-role', role),
  
  // Request screen capture permission (triggers native dialog on macOS)
  requestScreenCapturePermission: () => ipcRenderer.invoke('request-screen-capture-permission'),
  
  // App version
  getVersion: () => ipcRenderer.invoke('get-app-version'),

  // Screenshot service controls
  getScreenshotStatus: () => ipcRenderer.invoke('get-screenshot-status'),
  forceScreenshot: () => ipcRenderer.invoke('force-screenshot'),
  restartScreenshotService: () => ipcRenderer.invoke('restart-screenshot-service'),

  // Login notification - call this after successful login
  notifyLoginSuccess: () => ipcRenderer.invoke('notify-login-success'),
  
  // Permission management
  requestAllPermissions: () => ipcRenderer.invoke('request-all-permissions'),
  getPermissionStatus: () => ipcRenderer.invoke('get-permission-status'),
  
  // Session management
  getSessionInfo: () => ipcRenderer.invoke('get-session-info'),
  
  // Role-based capture restrictions
  getCaptureRestrictions: () => ipcRenderer.invoke('get-capture-restrictions'),
  
  // Manual capture request (for Admin/Dept Head to capture others)
  requestManualCapture: (targetUserId) => ipcRenderer.invoke('request-manual-capture', targetUserId),
  
  // Event listeners for capture notifications
  onCaptureComplete: (callback) => {
    ipcRenderer.on('capture-complete', (event, data) => callback(data));
  },
  
  // Remove capture listener
  removeCaptureListener: () => {
    ipcRenderer.removeAllListeners('capture-complete');
  }
});

// Intercept localStorage to sync auth tokens with main process
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  window.addEventListener('DOMContentLoaded', () => {
    // Override localStorage.setItem to capture auth token
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
      originalSetItem(key, value);
      
      // Sync token to main process and notify login
      if (key === 'token') {
        console.log('[Talio Desktop] Token set in localStorage, notifying main process');
        ipcRenderer.invoke('set-auth-token', value);
        // This triggers login detection in main process
        ipcRenderer.invoke('notify-login-success');
      }
      
      // Sync user data to main process
      if (key === 'user') {
        try {
          const userData = JSON.parse(value);
          if (userData._id) {
            ipcRenderer.invoke('set-user-id', userData._id);
            console.log('[Talio Desktop] User ID set:', userData._id);
          }
          if (userData.role) {
            ipcRenderer.invoke('set-user-role', userData.role);
            console.log('[Talio Desktop] User role set:', userData.role);
          }
          // User data also indicates login
          console.log('[Talio Desktop] User data set in localStorage');
          ipcRenderer.invoke('notify-login-success');
        } catch {
          // Ignore parse errors
        }
      }
    };

    // On load, sync existing token if present
    const existingToken = localStorage.getItem('token');
    if (existingToken) {
      console.log('[Talio Desktop] Found existing token, syncing...');
      ipcRenderer.invoke('set-auth-token', existingToken);
      // Delay login notification to let main process initialize
      setTimeout(() => {
        ipcRenderer.invoke('notify-login-success');
      }, 2000);
    }

    const existingUser = localStorage.getItem('user');
    if (existingUser) {
      try {
        const userData = JSON.parse(existingUser);
        if (userData._id) {
          ipcRenderer.invoke('set-user-id', userData._id);
        }
        if (userData.role) {
          ipcRenderer.invoke('set-user-role', userData.role);
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Add desktop app indicator to body for CSS targeting
    document.body.classList.add('talio-desktop-app');
    
    // Inject desktop app styles (hide any browser-specific elements)
    const style = document.createElement('style');
    style.textContent = `
      /* Hide elements that are browser-specific */
      .browser-only { display: none !important; }
      
      /* Show desktop-only elements */
      .desktop-only { display: block !important; }
      
      /* Optimize for desktop app */
      body.talio-desktop-app {
        overflow-x: hidden;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      
      /* Prevent text selection on drag */
      .no-drag {
        -webkit-user-select: none;
        user-select: none;
      }
      
      /* Capture status indicator */
      .capture-status-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 12px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .capture-status-indicator .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
        animation: pulse 2s ease-in-out infinite;
      }
      
      .capture-status-indicator.restricted .dot {
        background: #6b7280;
        animation: none;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.9); }
      }
    `;
    document.head.appendChild(style);

    // Create capture status indicator
    createCaptureStatusIndicator();

    console.log('[Talio Desktop] Preload script initialized');
  });
}

/**
 * Create a visual indicator for capture status
 */
function createCaptureStatusIndicator() {
  // Wait a bit for the app to fully load
  setTimeout(async () => {
    const indicator = document.createElement('div');
    indicator.className = 'capture-status-indicator';
    indicator.id = 'talio-capture-indicator';
    indicator.innerHTML = `
      <span class="dot"></span>
      <span class="text">Screen Capture Active</span>
    `;
    
    // Check if capture is restricted
    try {
      const restrictions = await ipcRenderer.invoke('get-capture-restrictions');
      if (restrictions.isRestricted) {
        indicator.classList.add('restricted');
        indicator.querySelector('.text').textContent = 'Capture Disabled (Admin)';
      }
    } catch (e) {
      console.log('[Talio Desktop] Could not check capture restrictions');
    }
    
    document.body.appendChild(indicator);
    
    // Update indicator on capture events
    ipcRenderer.on('capture-complete', (event, data) => {
      const textEl = indicator.querySelector('.text');
      if (textEl) {
        textEl.textContent = `Last capture: ${new Date().toLocaleTimeString()}`;
        setTimeout(() => {
          textEl.textContent = 'Screen Capture Active';
        }, 3000);
      }
    });
  }, 5000);
}

// Handle screen sharing for meetings
// Override getDisplayMedia to use Electron's desktopCapturer
if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
  
  navigator.mediaDevices.getDisplayMedia = async function(constraints) {
    console.log('[Talio Desktop] Screen share requested');
    
    // Request screen capture permission first
    await ipcRenderer.invoke('request-screen-capture-permission');
    
    // Use original getDisplayMedia - Electron handles the picker
    if (originalGetDisplayMedia) {
      return originalGetDisplayMedia(constraints);
    }
    
    throw new Error('Screen sharing not supported');
  };
}

// Log that we're in desktop mode
console.log('[Talio Desktop] Running in Electron desktop app');
