const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, systemPreferences, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { ScreenshotService } = require('./screenshotService');
const { PermissionHandler } = require('./permissionHandler');
const { SessionManager } = require('./sessionManager');
const { OfflineManager } = require('./offlineManager');

// Constants
const APP_URL = 'https://app.talio.in';
const store = new Store();

// Global references
let mainWindow = null;
let tray = null;
let screenshotService = null;
let permissionHandler = null;
let sessionManager = null;
let offlineManager = null;
let isQuitting = false;
let hasDetectedLogin = false;
let loginCheckInterval = null;
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

  // Create loading HTML content
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
        .logo svg {
          width: 100%;
          height: 100%;
        }
        h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        p {
          font-size: 14px;
          opacity: 0.9;
          margin-bottom: 24px;
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
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
 * Create offline window when internet is not available
 */
function showOfflineWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
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
          .icon {
            width: 80px;
            height: 80px;
            margin-bottom: 24px;
            opacity: 0.5;
          }
          h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 12px;
            color: #333;
          }
          p {
            font-size: 16px;
            color: #666;
            margin-bottom: 24px;
            text-align: center;
            max-width: 400px;
            line-height: 1.5;
          }
          button {
            padding: 12px 32px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
          }
          .status {
            margin-top: 24px;
            font-size: 14px;
            color: #888;
          }
          .dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ff6b6b;
            margin-right: 8px;
            animation: blink 2s ease-in-out infinite;
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        </style>
      </head>
      <body>
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>
        </svg>
        <h1>No Internet Connection</h1>
        <p>Please check your network connection and try again. Talio will automatically reconnect when the internet is available.</p>
        <button onclick="window.location.reload()">Try Again</button>
        <div class="status">
          <span class="dot"></span>
          Waiting for connection...
        </div>
      </body>
      </html>
    `;
    
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHTML)}`);
  }
}

/**
 * Create the main application window
 */
function createWindow() {
  // Show loading window first
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

  // Remove default menu
  mainWindow.setMenu(null);

  // Handle load errors (offline/network issues)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log(`[Main] Load failed: ${errorCode} - ${errorDescription}`);
    
    if (errorCode === -106 || errorCode === -105 || errorCode === -102 || errorCode === -118) {
      // Network errors - show offline page
      showOfflineWindow();
      
      // Start retry loop
      startNetworkRetry();
    }
  });

  // Load the app URL
  mainWindow.loadURL(APP_URL);

  // Show window when ready, hide loading
  mainWindow.once('ready-to-show', () => {
    // Close loading window
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
    }
    
    mainWindow.show();
    
    // Start periodic login check as fallback
    startLoginCheck();
  });

  // Handle page load completion
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    console.log('[Main] Page loaded:', url);
    
    // Check if this is the offline page
    if (!url.startsWith('data:')) {
      checkForLoginSuccess(url);
      stopNetworkRetry();
    }
  });

  // Detect navigation to dashboard (login success)
  mainWindow.webContents.on('did-navigate', (event, url) => {
    checkForLoginSuccess(url);
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    checkForLoginSuccess(url);
  });

  // Handle close event - minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show notification on first minimize
      if (!store.get('hasShownTrayNotification')) {
        tray?.displayBalloon?.({
          title: 'Talio',
          content: 'Talio is still running in the background. Click the tray icon to open.',
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
    const allowedPermissions = [
      'media',
      'mediaKeySystem',
      'geolocation',
      'notifications',
      'fullscreen',
      'display-capture',
      'pointerLock'
    ];
    
    callback(allowedPermissions.includes(permission));
  });

  // Handle display-capture for screen sharing in meetings
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

// Network retry variables
let networkRetryInterval = null;

function startNetworkRetry() {
  if (networkRetryInterval) return;
  
  console.log('[Main] Starting network retry...');
  networkRetryInterval = setInterval(async () => {
    try {
      const response = await fetch(APP_URL, { method: 'HEAD', timeout: 5000 });
      if (response.ok) {
        console.log('[Main] Network restored, reloading...');
        stopNetworkRetry();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(APP_URL);
        }
      }
    } catch (error) {
      console.log('[Main] Network still unavailable');
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
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Talio');

  updateTrayMenu();

  // Click to show window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  // Double click to show window
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * Update tray menu with current status
 */
function updateTrayMenu() {
  const isCapturing = screenshotService?.isRunning && sessionManager?.isSessionActive();
  const sessionInfo = sessionManager?.getCurrentSessionInfo() || {};
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Talio',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { type: 'separator' },
    {
      label: `Status: ${isCapturing ? 'Capturing' : 'Idle'}`,
      enabled: false
    },
    {
      label: `Session: ${sessionInfo.sessionNumber || '-'}/30`,
      enabled: false
    },
    {
      label: `Captures: ${sessionInfo.captureCount || 0}`,
      enabled: false
    }
  ]);

  tray?.setContextMenu(contextMenu);
}

/**
 * Initialize the application
 */
async function initialize() {
  // Create window and tray
  createWindow();
  createTray();

  // Initialize permission handler
  permissionHandler = new PermissionHandler(mainWindow);

  // Initialize session manager
  sessionManager = new SessionManager({
    sessionDuration: 30, // 30 minutes per session
    capturesPerSession: 30 // 30 captures per session (1 per minute)
  });

  // Initialize offline manager for queuing failed uploads
  offlineManager = new OfflineManager({
    apiUrl: `${APP_URL}/api/activity/screenshot`,
    getAuthToken: () => store.get('authToken')
  });

  // Initialize screenshot service with role checking
  screenshotService = new ScreenshotService({
    apiUrl: `${APP_URL}/api/activity/screenshot`,
    clockStatusUrl: `${APP_URL}/api/activity/clock-status`,
    userInfoUrl: `${APP_URL}/api/auth/me`,
    getAuthToken: () => store.get('authToken'),
    getUserRole: () => currentUserRole,
    getUserId: () => currentUserId,
    interval: 60000, // 1 minute
    sessionManager,
    offlineManager,
    onCaptureComplete: (data) => {
      updateTrayMenu();
      // Notify renderer about capture
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-complete', data);
      }
    }
  });

  // Setup auto-launch on boot
  setupAutoLaunch();
}

/**
 * Setup auto-launch on system boot
 */
function setupAutoLaunch() {
  const settings = {
    openAtLogin: true,
    openAsHidden: true
  };

  if (process.platform === 'darwin') {
    app.setLoginItemSettings(settings);
  } else if (process.platform === 'win32') {
    app.setLoginItemSettings({
      ...settings,
      path: app.getPath('exe')
    });
  }
}

/**
 * Check if URL indicates successful login (dashboard access)
 */
function checkForLoginSuccess(url) {
  if (hasDetectedLogin) return;
  
  const dashboardPatterns = [
    '/dashboard',
    '/employee',
    '/admin',
    '/manager',
    '/team'
  ];
  
  const isOnDashboard = dashboardPatterns.some(pattern => url.includes(pattern));
  const isNotLoginPage = !url.includes('/login') && !url.includes('/auth');
  
  if (isOnDashboard && isNotLoginPage) {
    console.log('[Login Detection] User navigated to dashboard:', url);
    onLoginSuccess('url_navigation');
  }
}

/**
 * Called when login is detected
 */
async function onLoginSuccess(source) {
  if (hasDetectedLogin) return;
  
  hasDetectedLogin = true;
  console.log(`[Login Detection] Login detected via: ${source}`);
  
  // Clear the periodic check
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval);
    loginCheckInterval = null;
  }
  
  // Fetch user info to get role
  await fetchUserInfo();
  
  // Request all permissions after short delay
  setTimeout(() => {
    console.log('[Permissions] Requesting all permissions after login...');
    permissionHandler.requestAllPermissions();
  }, 1500);
  
  // Start screenshot service if user is not admin
  setTimeout(() => {
    startCaptureIfAllowed();
  }, 3000);
}

/**
 * Fetch user info including role
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
        console.log(`[User Info] Role: ${currentUserRole}, ID: ${currentUserId}`);
      }
    }
  } catch (error) {
    console.error('[User Info] Failed to fetch user info:', error.message);
    // Fall back to stored values
    currentUserRole = store.get('userRole');
    currentUserId = store.get('userId');
  }
}

/**
 * Start capture only if user role allows it
 */
function startCaptureIfAllowed() {
  // CRITICAL: Admin screens must never be captured
  const restrictedRoles = ['admin', 'god_admin'];
  
  if (restrictedRoles.includes(currentUserRole)) {
    console.log(`[Capture] User role '${currentUserRole}' - screen capture DISABLED (admin restriction)`);
    return;
  }

  console.log(`[Capture] User role '${currentUserRole}' - starting automatic capture`);
  
  // Start the screenshot service
  if (screenshotService) {
    screenshotService.start();
  }
  
  // Start a new session
  if (sessionManager) {
    sessionManager.startNewSession(currentUserId);
  }

  // Force initial screenshot capture
  setTimeout(() => {
    if (screenshotService) {
      console.log('[Screenshots] Triggering initial screenshot capture...');
      screenshotService.forceCapture();
    }
  }, 2000);
}

/**
 * Start periodic check for login (fallback)
 */
function startLoginCheck() {
  loginCheckInterval = setInterval(() => {
    if (hasDetectedLogin) {
      clearInterval(loginCheckInterval);
      return;
    }
    
    // Check current URL
    if (mainWindow && mainWindow.webContents) {
      const url = mainWindow.webContents.getURL();
      checkForLoginSuccess(url);
    }
    
    // Also check if we have an auth token stored
    const authToken = store.get('authToken');
    if (authToken && !hasDetectedLogin) {
      console.log('[Login Detection] Auth token found in store');
      onLoginSuccess('stored_token');
    }
  }, 10000);
  
  // Also request permissions after 30 seconds regardless (fallback)
  setTimeout(() => {
    if (!hasDetectedLogin) {
      console.log('[Permissions] Fallback: Requesting permissions after timeout');
      permissionHandler.requestAllPermissions();
    }
  }, 30000);
}

// IPC Handlers
ipcMain.handle('get-auth-token', () => {
  return store.get('authToken');
});

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
  if (token && !hasDetectedLogin) {
    console.log('[Login Detection] Auth token set via IPC');
    onLoginSuccess('ipc_token');
  }
  return true;
});

ipcMain.handle('get-user-id', () => {
  return store.get('userId');
});

ipcMain.handle('set-user-id', (event, userId) => {
  store.set('userId', userId);
  currentUserId = userId;
  return true;
});

ipcMain.handle('set-user-role', (event, role) => {
  store.set('userRole', role);
  currentUserRole = role;
  return true;
});

ipcMain.handle('get-user-role', () => {
  return currentUserRole || store.get('userRole');
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('request-screen-capture-permission', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      const { desktopCapturer } = require('electron');
      await desktopCapturer.getSources({ types: ['screen'] });
    }
    return systemPreferences.getMediaAccessStatus('screen');
  }
  return 'granted';
});

// Screenshot service IPC handlers
ipcMain.handle('get-screenshot-status', () => {
  const serviceStatus = screenshotService?.getStatus() || { error: 'Service not initialized' };
  const sessionInfo = sessionManager?.getCurrentSessionInfo() || {};
  return { ...serviceStatus, session: sessionInfo };
});

ipcMain.handle('force-screenshot', async () => {
  // Check role restriction
  const restrictedRoles = ['admin', 'god_admin'];
  if (restrictedRoles.includes(currentUserRole)) {
    return { success: false, error: 'Admin screens cannot be captured' };
  }
  
  if (!screenshotService) {
    return { success: false, error: 'Service not initialized' };
  }
  return await screenshotService.forceCapture();
});

ipcMain.handle('restart-screenshot-service', () => {
  if (screenshotService) {
    screenshotService.stop();
    startCaptureIfAllowed();
    return { success: true, message: 'Screenshot service restarted' };
  }
  return { success: false, error: 'Service not initialized' };
});

// Login detection IPC handler - called from renderer when login detected
ipcMain.handle('notify-login-success', () => {
  console.log('[Login Detection] Login notification received from renderer');
  if (!hasDetectedLogin) {
    onLoginSuccess('renderer_notification');
  }
  return { success: true };
});

// Manual permission request handler
ipcMain.handle('request-all-permissions', async () => {
  console.log('[Permissions] Manual permission request from renderer');
  if (permissionHandler) {
    await permissionHandler.requestAllPermissions();
    return { success: true };
  }
  return { success: false, error: 'Permission handler not initialized' };
});

// Get permission status handler
ipcMain.handle('get-permission-status', () => {
  if (permissionHandler) {
    return permissionHandler.getStatus();
  }
  return { error: 'Permission handler not initialized' };
});

// Session management IPC handlers
ipcMain.handle('get-session-info', () => {
  if (sessionManager) {
    return sessionManager.getCurrentSessionInfo();
  }
  return { error: 'Session manager not initialized' };
});

ipcMain.handle('get-capture-restrictions', () => {
  const restrictedRoles = ['admin', 'god_admin'];
  return {
    currentRole: currentUserRole,
    isRestricted: restrictedRoles.includes(currentUserRole),
    restrictedRoles,
    reason: restrictedRoles.includes(currentUserRole) 
      ? 'Admin screens are never captured for privacy'
      : null
  };
});

// Manual capture request (for Admin/Dept Head to capture others)
ipcMain.handle('request-manual-capture', async (event, targetUserId) => {
  // Validate that requester has permission
  const allowedRoles = ['admin', 'god_admin', 'department_head'];
  if (!allowedRoles.includes(currentUserRole)) {
    return { success: false, error: 'Permission denied - only Admin or Department Head can initiate manual captures' };
  }

  // Admin cannot capture themselves
  if (targetUserId === currentUserId && ['admin', 'god_admin'].includes(currentUserRole)) {
    return { success: false, error: 'Admin cannot capture their own screen' };
  }

  // Note: Department head restrictions are validated on the backend
  return { 
    success: true, 
    message: 'Manual capture request validated',
    initiatorRole: currentUserRole,
    initiatorId: currentUserId,
    targetUserId
  };
});

// App event handlers
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  // Don't quit on window close - keep running in tray
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  screenshotService?.stop();
  sessionManager?.endSession();
  offlineManager?.flush();
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Prevent navigation to unknown URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedHosts = ['app.talio.in', 'talio.in', 'accounts.google.com', 'www.google.com'];
    
    if (!allowedHosts.some(host => parsedUrl.host.includes(host))) {
      event.preventDefault();
    }
  });
});
