/**
 * Preload Script v4.0.0
 * Exposes secure IPC channels to the renderer process
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
  getDesktopSources: async function(options) {
    try {
      const sources = await desktopCapturer.getSources(options || {
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 },
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
  }
});

// Also expose a flag to indicate this is running in Electron
contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('platform', process.platform);

console.log('[Preload] Talio Desktop API exposed');
