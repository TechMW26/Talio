const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - Simplified Version
 * Exposes safe APIs to renderer process
 */

// Expose Talio Desktop API to renderer
contextBridge.exposeInMainWorld('talioDesktop', {
  // Identify as desktop app
  isDesktopApp: true,
  
  // Platform info
  platform: process.platform,
  
  // Auth token management
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('clear-auth-token'),
  checkAuthToken: () => ipcRenderer.invoke('check-auth-token'),
  
  // App version
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Capture status and controls
  getCaptureStatus: () => ipcRenderer.invoke('get-capture-status'),
  forceCapture: () => ipcRenderer.invoke('force-capture'),
  
  // Permission management
  getPermissionStatus: () => ipcRenderer.invoke('get-permission-status'),
  retryPermissions: () => ipcRenderer.invoke('retry-permissions'),
  openSystemPreferences: () => ipcRenderer.invoke('open-system-preferences'),
  
  // Location services
  requestLocationPermission: () => ipcRenderer.invoke('request-location-permission'),
  getCurrentLocation: () => ipcRenderer.invoke('get-current-location'),
  
  // Google OAuth via system browser
  openGoogleOAuth: () => ipcRenderer.invoke('open-google-oauth'),
  
  // Open external URL in system browser (for OAuth)
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
  
  // Storage info
  getStoragePaths: () => ipcRenderer.invoke('get-storage-paths'),
  
  // Event listeners
  onCaptureComplete: (callback) => {
    ipcRenderer.on('capture-complete', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('capture-complete');
  },
  
  onUploadComplete: (callback) => {
    ipcRenderer.on('upload-complete', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('upload-complete');
  },
  
  onPermissionBlocked: (callback) => {
    ipcRenderer.on('permission-blocked', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('permission-blocked');
  },
  
  // Listen for auth token from deep link
  onAuthReceived: (callback) => {
    ipcRenderer.on('auth-token-received', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('auth-token-received');
  }
});

// Also expose for permission blocked screen
contextBridge.exposeInMainWorld('talioAPI', {
  openSystemPreferences: () => ipcRenderer.invoke('open-system-preferences'),
  retryPermissions: () => ipcRenderer.invoke('retry-permissions')
});

// Sync localStorage auth token with main process
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    // Override localStorage.setItem
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
      originalSetItem(key, value);
      
      // Sync token to main process
      if (key === 'token') {
        console.log('[Talio] Token set, syncing to desktop app');
        ipcRenderer.invoke('set-auth-token', value);
      }
    };
    
    // Override localStorage.removeItem for logout
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function(key) {
      originalRemoveItem(key);
      
      if (key === 'token') {
        console.log('[Talio] Token removed, clearing from desktop app');
        ipcRenderer.invoke('clear-auth-token');
      }
    };
    
    // Sync existing token if present
    const existingToken = localStorage.getItem('token');
    if (existingToken) {
      console.log('[Talio] Syncing existing token to desktop app');
      ipcRenderer.invoke('set-auth-token', existingToken);
    }
  });
}

// Log desktop app info
console.log('[Talio Desktop] Preload initialized');
console.log('[Talio Desktop] Platform:', process.platform);
