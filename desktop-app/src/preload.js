/**
 * Preload Script v4.1.0
 * Exposes secure IPC channels to the renderer process
 * With enhanced screen sharing support for Windows multi-display
 */

const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

// Expose protected methods to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: function() {
    return ipcRenderer.invoke('get-app-version');
  },
  
  // Authentication
  onAuthSuccess: function(callback) {
    ipcRenderer.on('auth-success', function(event, data) {
      callback(data);
    });
  },
  
  sendAuthData: function(data) {
    return ipcRenderer.invoke('auth-data', data);
  },
  
  logout: function() {
    return ipcRenderer.invoke('logout');
  },
  
  // Screenshot service
  startCapture: function() {
    return ipcRenderer.invoke('start-capture');
  },
  
  stopCapture: function() {
    return ipcRenderer.invoke('stop-capture');
  },
  
  manualCapture: function() {
    return ipcRenderer.invoke('manual-capture');
  },
  
  getCaptureStatus: function() {
    return ipcRenderer.invoke('get-capture-status');
  },
  
  getCaptureStats: function() {
    return ipcRenderer.invoke('get-capture-stats');
  },
  
  // Desktop capture for screen sharing (used by meetings)
  // Returns all available screens and windows with display info
  getDesktopSources: async function(options) {
    try {
      const sources = await desktopCapturer.getSources(options || {
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
      return sources.map(function(source) {
        return {
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL(),
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
          display_id: source.display_id
        };
      });
    } catch (error) {
      console.error('[Preload] Error getting desktop sources:', error);
      return [];
    }
  },
  
  // Get all connected displays for multi-monitor selection
  getDisplays: function() {
    return ipcRenderer.invoke('get-displays');
  },
  
  // Request screen sharing with source picker (for Windows)
  requestScreenShare: function() {
    return ipcRenderer.invoke('request-screen-share');
  },
  
  // Get screen share stream directly via IPC
  getScreenShareStream: async function(sourceId) {
    return ipcRenderer.invoke('get-screen-share-stream', sourceId);
  },
  
  // Session management
  getSessionInfo: function() {
    return ipcRenderer.invoke('get-session-info');
  },
  
  // Network status
  setOnlineStatus: function(online) {
    return ipcRenderer.invoke('set-online-status', online);
  },
  
  // Window controls
  minimizeWindow: function() {
    return ipcRenderer.invoke('minimize-window');
  },
  
  maximizeWindow: function() {
    return ipcRenderer.invoke('maximize-window');
  },
  
  closeWindow: function() {
    return ipcRenderer.invoke('close-window');
  },
  
  // Notifications
  showNotification: function(title, body) {
    return ipcRenderer.invoke('show-notification', { title: title, body: body });
  },
  
  // Event listeners
  onCaptureStatus: function(callback) {
    ipcRenderer.on('capture-status', function(event, data) {
      callback(data);
    });
  },
  
  onSessionUpdate: function(callback) {
    ipcRenderer.on('session-update', function(event, data) {
      callback(data);
    });
  },
  
  onNotification: function(callback) {
    ipcRenderer.on('notification', function(event, data) {
      callback(data);
    });
  },
  
  onSocketStatus: function(callback) {
    ipcRenderer.on('socket-status', function(event, data) {
      callback(data);
    });
  },
  
  onOnlineStatus: function(callback) {
    ipcRenderer.on('online-status', function(event, data) {
      callback(data);
    });
  },
  
  // Remove listeners
  removeAllListeners: function(channel) {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // Restart app (for crash recovery)
  restartApp: function() {
    return ipcRenderer.invoke('restart-app');
  },
  
  // Load main app (for offline page retry)
  loadApp: function() {
    return ipcRenderer.invoke('load-app');
  },
  
  // Check if running on Windows (for screen share workaround)
  isWindows: function() {
    return process.platform === 'win32';
  },
  
  // Check platform
  getPlatform: function() {
    return process.platform;
  }
});

// Also expose a flag to indicate this is running in Electron
contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('platform', process.platform);

console.log('[Preload] Talio Desktop API exposed');
