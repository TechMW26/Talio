const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script
 * Exposes safe APIs to the renderer process for:
 * - Authentication token management
 * - Screen sharing for meetings
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
  getPermissionStatus: () => ipcRenderer.invoke('get-permission-status')
});

// Intercept localStorage to sync auth tokens with main process
const originalSetItem = window.localStorage?.setItem;
const originalGetItem = window.localStorage?.getItem;

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
            // User data also indicates login
            console.log('[Talio Desktop] User data set in localStorage');
            ipcRenderer.invoke('notify-login-success');
          }
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
    `;
    document.head.appendChild(style);

    console.log('[Talio Desktop] Preload script initialized');
  });
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
