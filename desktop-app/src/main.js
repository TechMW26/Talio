const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { ScreenshotService } = require('./screenshotService');
const { PermissionHandler } = require('./permissionHandler');
const { SessionManager } = require('./sessionManager');
const { LocalStorageManager } = require('./localStorageManager');

// Constants
const APP_URL = 'https://app.talio.in';
const store = new Store();

// Global references
let mainWindow = null;
let tray = null;
let screenshotService = null;
let permissionHandler = null;
let sessionManager = null;
let localStorageManager = null;
let isQuitting = false;
let hasDetectedLogin = false;
let loginCheckInterval = null;
let networkRetryInterval = null;
let currentUserRole = null;
let currentUserId = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Handle second instance - focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

/**
 * Create loading window while app initializes
 */
function createLoadingWindow() {
  const loadingWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const loadingHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: white;
          user-select: none;
          -webkit-app-region: drag;
          border-radius: 16px;
        }
        .logo {
          width: 80px;
          height: 80px;
          margin-bottom: 24px;
          animation: pulse 2s ease-in-out infinite;
        }
        h1 { font-size: 28px; font-weight: 600; margin-bottom: 8px; }
        p { font-size: 14px; opacity: 0.9; margin-bottom: 24px; }
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
      </style>
    </head>
    <body>
      <div class="logo">
        <svg viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="45" stroke="white" stroke-width="4"/>
          <path d="M30 50 L45 65 L70 35" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      <h1>Talio</h1>
      <p>Loading your workspace...</p>
      <div class="spinner"></div>
    </body>
    </html>
  `;

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);
  return loadingWindow;
}

/**
 * Show offline window when network is unavailable
 */
function showOfflineWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  const offlineHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f5f5;
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #333;
        }
        .icon { width: 80px; height: 80px; margin-bottom: 24px; opacity: 0.5; }
        h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
        p { font-size: 16px; color: #666; margin-bottom: 24px; text-align: center; max-width: 400px; line-height: 1.5; }
        button {
          padding: 12px 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover { transform: translateY(-2px); }
        .status { margin-top: 24px; font-size: 14px; color: #888; }
        .dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #ff6b6b;
          margin-right: 8px;
          animation: blink 2s ease-in-out infinite;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      </style>
    </head>
    <body>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>
      </svg>
      <h1>No Internet Connection</h1>
      <p>Please check your network connection. Talio will reconnect automatically when the internet is available.</p>
      <button onclick="window.location.reload()">Try Again</button>
      <div class="status"><span class="dot"></span>Waiting for connection...</div>
    </body>
    </html>
  `;
  
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHTML)}`);
}

/**
 * Create the main application window
 */
function createWindow() {
  const loadingWindow = createLoadingWindow();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#ffffff',
    show: false,
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:talio',
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png')
  });

  mainWindow.setMenu(null);

  // Handle load errors (offline/network issues)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[Main] Load failed: ${errorCode} - ${errorDescription}`);
    
    if ([-106, -105, -102, -118].includes(errorCode)) {
      showOfflineWindow();
      startNetworkRetry();
    }
  });

  // Load the app
  mainWindow.loadURL(APP_URL);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
    }
    mainWindow.show();
    startLoginCheck();
  });

  // Handle page load
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    console.log('[Main] Page loaded:', url);
    
    if (!url.startsWith('data:')) {
      checkForLoginSuccess(url);
      stopNetworkRetry();
    }
  });

  // Detect navigation to dashboard
  mainWindow.webContents.on('did-navigate', (event, url) => checkForLoginSuccess(url));
  mainWindow.webContents.on('did-navigate-in-page', (event, url) => checkForLoginSuccess(url));

  // Handle close - minimize to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      if (!store.get('hasShownTrayNotification')) {
        tray?.displayBalloon?.({
          title: 'Talio',
          content: 'Talio is running in the background. Click the tray icon to open.',
          iconType: 'info'
        });
        store.set('hasShownTrayNotification', true);
      }
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('accounts.google.com') || url.includes('talio.in')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle permission requests from web content
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'fullscreen', 'display-capture', 'pointerLock'];
    callback(allowed.includes(permission));
  });

  // Handle display-capture
  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    require('electron').desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    });
  });

  return mainWindow;
}

/**
 * Start network retry loop
 */
function startNetworkRetry() {
  if (networkRetryInterval) return;
  
  console.log('[Main] Starting network retry...');
  networkRetryInterval = setInterval(async () => {
    try {
      const response = await fetch(APP_URL, { method: 'HEAD' });
      if (response.ok) {
        console.log('[Main] Network restored!');
        stopNetworkRetry();
        mainWindow?.loadURL(APP_URL);
      }
    } catch {
      // Still offline
    }
  }, 5000);
}

function stopNetworkRetry() {
  if (networkRetryInterval) {
    clearInterval(networkRetryInterval);
    networkRetryInterval = null;
  }
}

/**
 * Create system tray
 */
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  let trayIcon;
  
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Talio');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * Update tray menu
 */
function updateTrayMenu() {
  const isCapturing = screenshotService?.isRunning;
  const sessionInfo = sessionManager?.getCurrentSessionInfo() || {};
  const storageStats = localStorageManager?.getStats() || {};

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Talio', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: `Status: ${isCapturing ? 'Capturing' : 'Idle'}`, enabled: false },
    { label: `Session: ${sessionInfo.sessionNumber || '-'}`, enabled: false },
    { label: `Captures: ${storageStats.totalSaved || 0}`, enabled: false },
    { label: `Pending: ${storageStats.pendingCount || 0}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray?.setContextMenu(contextMenu);
}

/**
 * Initialize the application
 */
async function initialize() {
  createWindow();
  createTray();

  // Initialize permission handler
  permissionHandler = new PermissionHandler(mainWindow);

  // Initialize local storage manager
  localStorageManager = new LocalStorageManager({
    retentionDays: 7,
    uploadRetryInterval: 30000
  });

  // Initialize session manager
  sessionManager = new SessionManager({
    sessionDuration: 30,
    capturesPerSession: 30
  });

  // Initialize screenshot service
  screenshotService = new ScreenshotService({
    apiUrl: `${APP_URL}/api/activity/screenshot`,
    clockStatusUrl: `${APP_URL}/api/activity/clock-status`,
    getAuthToken: () => store.get('authToken'),
    getUserRole: () => currentUserRole,
    getUserId: () => currentUserId,
    interval: 60000, // 1 minute
    localStorageManager,
    sessionManager,
    onCaptureComplete: (data) => {
      updateTrayMenu();
      mainWindow?.webContents?.send('capture-complete', data);
    },
    onUploadComplete: (data) => {
      updateTrayMenu();
      mainWindow?.webContents?.send('upload-complete', data);
    }
  });

  setupAutoLaunch();
}

/**
 * Setup auto-launch on boot
 */
function setupAutoLaunch() {
  const settings = { openAtLogin: true, openAsHidden: true };
  
  if (process.platform === 'darwin') {
    app.setLoginItemSettings(settings);
  } else if (process.platform === 'win32') {
    app.setLoginItemSettings({ ...settings, path: app.getPath('exe') });
  }
}

/**
 * Check if URL indicates successful login
 */
function checkForLoginSuccess(url) {
  if (hasDetectedLogin) return;
  
  const dashboardPatterns = ['/dashboard', '/employee', '/admin', '/manager', '/team'];
  const isOnDashboard = dashboardPatterns.some(p => url.includes(p));
  const isNotLoginPage = !url.includes('/login') && !url.includes('/auth');
  
  if (isOnDashboard && isNotLoginPage) {
    console.log('[Main] Login detected:', url);
    onLoginSuccess('url_navigation');
  }
}

/**
 * Called when login is detected
 */
async function onLoginSuccess(source) {
  if (hasDetectedLogin) return;
  
  hasDetectedLogin = true;
  console.log(`[Main] Login detected via: ${source}`);
  
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval);
    loginCheckInterval = null;
  }
  
  // Fetch user info
  await fetchUserInfo();
  
  // Request all permissions (will block if required permissions not granted)
  setTimeout(async () => {
    console.log('[Main] Requesting permissions...');
    const permissionsGranted = await permissionHandler.requestAllPermissions();
    
    if (permissionsGranted) {
      // Start capture if allowed
      setTimeout(() => startCaptureIfAllowed(), 2000);
    }
  }, 1500);
}

/**
 * Fetch user info
 */
async function fetchUserInfo() {
  const token = store.get('authToken');
  if (!token) return;

  try {
    const response = await fetch(`${APP_URL}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.user) {
        currentUserRole = data.user.role;
        currentUserId = data.user._id;
        store.set('userRole', currentUserRole);
        store.set('userId', currentUserId);
        console.log(`[Main] User: role=${currentUserRole}, id=${currentUserId}`);
      }
    }
  } catch (error) {
    console.error('[Main] Failed to fetch user info:', error.message);
    currentUserRole = store.get('userRole');
    currentUserId = store.get('userId');
  }
}

/**
 * Start capture if user role allows
 */
function startCaptureIfAllowed() {
  const restrictedRoles = ['admin', 'god_admin'];
  
  if (restrictedRoles.includes(currentUserRole)) {
    console.log(`[Main] Role '${currentUserRole}' is restricted - capture disabled`);
    return;
  }

  console.log(`[Main] Starting capture for role '${currentUserRole}'`);
  
  screenshotService?.start();
  sessionManager?.startNewSession(currentUserId);

  // Initial capture
  setTimeout(() => {
    screenshotService?.forceCapture();
  }, 2000);
}

/**
 * Start periodic login check (fallback)
 */
function startLoginCheck() {
  loginCheckInterval = setInterval(() => {
    if (hasDetectedLogin) {
      clearInterval(loginCheckInterval);
      return;
    }
    
    if (mainWindow?.webContents) {
      checkForLoginSuccess(mainWindow.webContents.getURL());
    }
    
    const authToken = store.get('authToken');
    if (authToken && !hasDetectedLogin) {
      console.log('[Main] Auth token found');
      onLoginSuccess('stored_token');
    }
  }, 10000);
  
  // Fallback permission request
  setTimeout(() => {
    if (!hasDetectedLogin) {
      console.log('[Main] Fallback: Requesting permissions');
      permissionHandler?.requestAllPermissions();
    }
  }, 30000);
}

// IPC Handlers
ipcMain.handle('get-auth-token', () => store.get('authToken'));

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
  if (token && !hasDetectedLogin) {
    console.log('[Main] Auth token set via IPC');
    onLoginSuccess('ipc_token');
  }
  return true;
});

ipcMain.handle('clear-auth-token', () => {
  store.delete('authToken');
  store.delete('userRole');
  store.delete('userId');
  hasDetectedLogin = false;
  currentUserRole = null;
  currentUserId = null;
  screenshotService?.stop();
  return true;
});

ipcMain.handle('get-capture-status', () => {
  return {
    isCapturing: screenshotService?.isRunning || false,
    isClockedIn: screenshotService?.isClockedIn || false,
    role: currentUserRole,
    isRoleRestricted: ['admin', 'god_admin'].includes(currentUserRole),
    stats: screenshotService?.getStatus() || {},
    session: sessionManager?.getCurrentSessionInfo() || {},
    storage: localStorageManager?.getStats() || {}
  };
});

ipcMain.handle('force-capture', async () => {
  return await screenshotService?.forceCapture();
});

ipcMain.handle('get-permission-status', () => {
  return permissionHandler?.getStatus();
});

ipcMain.handle('retry-permissions', async () => {
  return await permissionHandler?.retryPermissions();
});

ipcMain.handle('open-system-preferences', () => {
  permissionHandler?.openSystemPreferences();
  return true;
});

ipcMain.handle('get-storage-paths', () => {
  return localStorageManager?.getPaths();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// App lifecycle
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  screenshotService?.stop();
  localStorageManager?.stop();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
