const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, shell, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { ScreenshotService } = require('./screenshotService');
const { PermissionHandler } = require('./permissionHandler');
const { SessionManager } = require('./sessionManager');
const { LocalStorageManager } = require('./localStorageManager');
const { getLogger } = require('./debugLogger');

// Constants
const APP_URL = 'https://app.talio.in';
const store = new Store();
const logger = getLogger();

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
let healthCheckInterval = null;
let currentUserRole = null;
let currentUserId = null;

// Health status
let healthStatus = {
  server: 'unknown',      // 'healthy', 'unhealthy', 'unknown'
  lastCheck: null,
  lastCapture: null,
  lastUpload: null,
  captureCount: 0,
  uploadCount: 0,
  failedCount: 0
};

// Tray icon states
const TRAY_STATES = {
  IDLE: 'idle',           // Gray - not capturing
  CAPTURING: 'capturing', // Green - actively capturing
  ERROR: 'error',         // Red - health check failed
  UPLOADING: 'uploading'  // Blue - uploading
};
let currentTrayState = TRAY_STATES.IDLE;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

/**
 * Create tray icon with specific color/state
 */
function createTrayIcon(state) {
  const size = 16;
  const canvas = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="${getStateColor(state)}" stroke="#333" stroke-width="1"/>
      ${state === TRAY_STATES.CAPTURING ? '<circle cx="8" cy="8" r="3" fill="white"/>' : ''}
      ${state === TRAY_STATES.UPLOADING ? '<path d="M8 4 L8 12 M5 7 L8 4 L11 7" stroke="white" stroke-width="1.5" fill="none"/>' : ''}
      ${state === TRAY_STATES.ERROR ? '<path d="M6 6 L10 10 M10 6 L6 10" stroke="white" stroke-width="1.5"/>' : ''}
    </svg>
  `;
  
  // For production, use pre-built icons
  const iconPath = path.join(__dirname, '..', 'build', `tray-${state}.png`);
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 });
    }
  } catch {}
  
  // Fallback to basic icon
  const fallbackPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  try {
    const icon = nativeImage.createFromPath(fallbackPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 });
    }
  } catch {}
  
  return nativeImage.createEmpty();
}

function getStateColor(state) {
  switch (state) {
    case TRAY_STATES.CAPTURING: return '#22c55e'; // Green
    case TRAY_STATES.ERROR: return '#ef4444';     // Red
    case TRAY_STATES.UPLOADING: return '#3b82f6'; // Blue
    default: return '#6b7280';                     // Gray
  }
}

/**
 * Update tray icon state
 */
function setTrayState(state) {
  if (currentTrayState === state) return;
  currentTrayState = state;
  
  if (tray) {
    const icon = createTrayIcon(state);
    tray.setImage(icon);
    
    const tooltips = {
      [TRAY_STATES.IDLE]: 'Talio - Idle',
      [TRAY_STATES.CAPTURING]: 'Talio - Capturing',
      [TRAY_STATES.ERROR]: 'Talio - Connection Error',
      [TRAY_STATES.UPLOADING]: 'Talio - Uploading'
    };
    tray.setToolTip(tooltips[state] || 'Talio');
  }
  
  logger.info(`Tray state changed to: ${state}`);
}

/**
 * Flash tray icon briefly (for capture indication)
 */
function flashTrayIcon() {
  const originalState = currentTrayState;
  setTrayState(TRAY_STATES.CAPTURING);
  
  setTimeout(() => {
    if (healthStatus.server === 'unhealthy') {
      setTrayState(TRAY_STATES.ERROR);
    } else {
      setTrayState(originalState === TRAY_STATES.CAPTURING ? TRAY_STATES.IDLE : originalState);
    }
  }, 2000);
}

/**
 * Create loading window
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
    webPreferences: { nodeIntegration: false, contextIsolation: true }
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
        .logo { width: 80px; height: 80px; margin-bottom: 24px; animation: pulse 2s ease-in-out infinite; }
        h1 { font-size: 28px; font-weight: 600; margin-bottom: 8px; }
        p { font-size: 14px; opacity: 0.9; margin-bottom: 24px; }
        .spinner {
          width: 40px; height: 40px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
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
 * Show offline window
 */
function showOfflineWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  setTrayState(TRAY_STATES.ERROR);
  
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
        h1 { font-size: 24px; margin-bottom: 12px; }
        p { font-size: 16px; color: #666; margin-bottom: 24px; text-align: center; max-width: 400px; }
        button {
          padding: 12px 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;
        }
        button:hover { transform: translateY(-2px); }
        .status { margin-top: 24px; font-size: 14px; color: #888; }
        .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff6b6b; margin-right: 8px; animation: blink 2s infinite; }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      </style>
    </head>
    <body>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39"/>
      </svg>
      <h1>No Internet Connection</h1>
      <p>Please check your network. Talio will reconnect automatically.</p>
      <button onclick="window.location.reload()">Try Again</button>
      <div class="status"><span class="dot"></span>Waiting for connection...</div>
    </body>
    </html>
  `;
  
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHTML)}`);
}

/**
 * Create main window
 */
function createWindow() {
  logger.info('Creating main window...');
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
      backgroundThrottling: false
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png')
  });

  mainWindow.setMenu(null);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error(`Load failed: ${errorCode} - ${errorDescription}`);
    if ([-106, -105, -102, -118].includes(errorCode)) {
      showOfflineWindow();
      startNetworkRetry();
    }
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
    }
    mainWindow.show();
    logger.info('Main window ready');
    startLoginCheck();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    logger.info(`Page loaded: ${url}`);
    if (!url.startsWith('data:')) {
      checkForLoginSuccess(url);
      stopNetworkRetry();
    }
  });

  mainWindow.webContents.on('did-navigate', (e, url) => checkForLoginSuccess(url));
  mainWindow.webContents.on('did-navigate-in-page', (e, url) => checkForLoginSuccess(url));

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (!store.get('hasShownTrayNotification')) {
        tray?.displayBalloon?.({
          title: 'Talio',
          content: 'Running in background. Click tray icon to open.',
          iconType: 'info'
        });
        store.set('hasShownTrayNotification', true);
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('accounts.google.com') || url.includes('talio.in')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(['media', 'mediaKeySystem', 'geolocation', 'notifications', 'fullscreen', 'display-capture', 'pointerLock'].includes(perm));
  });

  mainWindow.webContents.session.setDisplayMediaRequestHandler((req, cb) => {
    require('electron').desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      cb(sources.length > 0 ? { video: sources[0], audio: 'loopback' } : {});
    });
  });

  return mainWindow;
}

/**
 * Network retry
 */
function startNetworkRetry() {
  if (networkRetryInterval) return;
  logger.info('Starting network retry...');
  
  networkRetryInterval = setInterval(async () => {
    try {
      const response = await fetch(APP_URL, { method: 'HEAD' });
      if (response.ok) {
        logger.info('Network restored!');
        stopNetworkRetry();
        mainWindow?.loadURL(APP_URL);
        setTrayState(TRAY_STATES.IDLE);
      }
    } catch {}
  }, 5000);
}

function stopNetworkRetry() {
  if (networkRetryInterval) {
    clearInterval(networkRetryInterval);
    networkRetryInterval = null;
  }
}

/**
 * Health check - verify server connectivity
 */
async function performHealthCheck() {
  const token = store.get('authToken');
  if (!token) {
    healthStatus.server = 'unknown';
    return;
  }

  try {
    const response = await fetch(`${APP_URL}/api/activity/health`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });

    if (response.ok) {
      healthStatus.server = 'healthy';
      healthStatus.lastCheck = Date.now();
      if (currentTrayState === TRAY_STATES.ERROR) {
        setTrayState(screenshotService?.isRunning ? TRAY_STATES.IDLE : TRAY_STATES.IDLE);
      }
      logger.health('healthy', { status: response.status });
    } else {
      healthStatus.server = 'unhealthy';
      setTrayState(TRAY_STATES.ERROR);
      logger.health('unhealthy', { status: response.status });
    }
  } catch (error) {
    healthStatus.server = 'unhealthy';
    setTrayState(TRAY_STATES.ERROR);
    logger.health('error', { error: error.message });
  }
}

function startHealthCheck() {
  performHealthCheck();
  healthCheckInterval = setInterval(performHealthCheck, 60000); // Every 1 minute
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Create tray
 */
function createTray() {
  logger.info('Creating system tray...');
  const icon = createTrayIcon(TRAY_STATES.IDLE);
  tray = new Tray(icon);
  tray.setToolTip('Talio');
  updateTrayMenu();

  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.focus() : mainWindow?.show();
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
  const stats = localStorageManager?.getStats() || {};
  const sessionInfo = sessionManager?.getCurrentSessionInfo() || {};
  
  const statusText = healthStatus.server === 'healthy' ? '● Connected' : 
                     healthStatus.server === 'unhealthy' ? '○ Disconnected' : '◐ Unknown';

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Talio', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: `Status: ${statusText}`, enabled: false },
    { label: `Captures: ${healthStatus.captureCount}`, enabled: false },
    { label: `Pending Uploads: ${stats.pendingCount || 0}`, enabled: false },
    { label: `Session: ${sessionInfo.sessionNumber || '-'}`, enabled: false },
    { type: 'separator' },
    { label: 'View Logs', click: () => {
      const logPath = logger.getLogPath();
      shell.showItemInFolder(logPath);
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray?.setContextMenu(contextMenu);
}

/**
 * Initialize application
 */
async function initialize() {
  logger.info('Initializing Talio Desktop...');
  
  createWindow();
  createTray();

  permissionHandler = new PermissionHandler(mainWindow);

  localStorageManager = new LocalStorageManager({
    retentionDays: 7,
    uploadRetryInterval: 30000
  });

  sessionManager = new SessionManager({
    sessionDuration: 30,
    capturesPerSession: 30
  });

  // Initialize screenshot service WITHOUT clock-in requirement
  screenshotService = new ScreenshotService({
    apiUrl: `${APP_URL}/api/activity/screenshot`,
    healthUrl: `${APP_URL}/api/activity/health`,
    getAuthToken: () => store.get('authToken'),
    getUserRole: () => currentUserRole,
    getUserId: () => currentUserId,
    interval: 60000, // 1 minute
    requireClockIn: false, // DISABLED - capture always after login
    localStorageManager,
    sessionManager,
    logger,
    onCaptureStart: () => {
      flashTrayIcon();
    },
    onCaptureComplete: (data) => {
      healthStatus.captureCount++;
      healthStatus.lastCapture = Date.now();
      updateTrayMenu();
      mainWindow?.webContents?.send('capture-complete', data);
      logger.capture(true, { size: data.size, path: data.localPath });
    },
    onCaptureFailed: (error) => {
      healthStatus.failedCount++;
      logger.capture(false, { error });
    },
    onUploadComplete: (data) => {
      healthStatus.uploadCount++;
      healthStatus.lastUpload = Date.now();
      setTrayState(TRAY_STATES.IDLE);
      updateTrayMenu();
      logger.upload(true, { path: data.serverPath });
    },
    onUploadFailed: (error) => {
      logger.upload(false, { error });
    },
    onUploadStart: () => {
      setTrayState(TRAY_STATES.UPLOADING);
    }
  });

  setupAutoLaunch();
  startHealthCheck();
  
  logger.info('Initialization complete');
}

/**
 * Auto-launch setup
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
 * Check for login
 */
function checkForLoginSuccess(url) {
  if (hasDetectedLogin) return;
  
  const dashboardPatterns = ['/dashboard', '/employee', '/admin', '/manager', '/team'];
  const isOnDashboard = dashboardPatterns.some(p => url.includes(p));
  const isNotLoginPage = !url.includes('/login') && !url.includes('/auth');
  
  if (isOnDashboard && isNotLoginPage) {
    logger.info(`Login detected: ${url}`);
    onLoginSuccess('url_navigation');
  }
}

/**
 * Handle login success
 */
async function onLoginSuccess(source) {
  if (hasDetectedLogin) return;
  
  hasDetectedLogin = true;
  logger.info(`Login success via: ${source}`);
  
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval);
    loginCheckInterval = null;
  }
  
  await fetchUserInfo();
  
  setTimeout(async () => {
    logger.info('Requesting permissions...');
    const granted = await permissionHandler.requestAllPermissions();
    
    if (granted) {
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
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.user) {
        currentUserRole = data.user.role;
        currentUserId = data.user._id;
        store.set('userRole', currentUserRole);
        store.set('userId', currentUserId);
        logger.info(`User info: role=${currentUserRole}, id=${currentUserId}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to fetch user info: ${error.message}`);
    currentUserRole = store.get('userRole');
    currentUserId = store.get('userId');
  }
}

/**
 * Start capture
 */
function startCaptureIfAllowed() {
  const restrictedRoles = ['admin', 'god_admin'];
  
  if (restrictedRoles.includes(currentUserRole)) {
    logger.info(`Role '${currentUserRole}' is restricted - capture disabled`);
    return;
  }

  logger.info(`Starting capture for role '${currentUserRole}'`);
  
  screenshotService?.start();
  sessionManager?.startNewSession(currentUserId);

  // Initial capture after 3 seconds
  setTimeout(() => {
    logger.info('Triggering initial capture...');
    screenshotService?.forceCapture();
  }, 3000);
}

/**
 * Login check fallback
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
      logger.info('Auth token found in store');
      onLoginSuccess('stored_token');
    }
  }, 10000);
  
  setTimeout(() => {
    if (!hasDetectedLogin) {
      logger.info('Fallback: Requesting permissions');
      permissionHandler?.requestAllPermissions();
    }
  }, 30000);
}

// IPC Handlers
ipcMain.handle('get-auth-token', () => store.get('authToken'));

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
  if (token && !hasDetectedLogin) {
    logger.info('Auth token set via IPC');
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
  setTrayState(TRAY_STATES.IDLE);
  return true;
});

ipcMain.handle('get-capture-status', () => ({
  isCapturing: screenshotService?.isRunning || false,
  role: currentUserRole,
  isRoleRestricted: ['admin', 'god_admin'].includes(currentUserRole),
  health: healthStatus,
  stats: screenshotService?.getStatus() || {},
  session: sessionManager?.getCurrentSessionInfo() || {},
  storage: localStorageManager?.getStats() || {}
}));

ipcMain.handle('force-capture', async () => {
  logger.info('Force capture requested');
  return await screenshotService?.forceCapture();
});

ipcMain.handle('get-permission-status', () => permissionHandler?.getStatus());
ipcMain.handle('retry-permissions', async () => permissionHandler?.retryPermissions());
ipcMain.handle('open-system-preferences', () => { permissionHandler?.openSystemPreferences(); return true; });
ipcMain.handle('get-storage-paths', () => localStorageManager?.getPaths());
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-log-path', () => logger.getLogPath());
ipcMain.handle('get-recent-logs', (event, lines) => logger.getRecentLogs(lines));
ipcMain.handle('get-health-status', () => healthStatus);

// App lifecycle
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
  stopHealthCheck();
  logger.info('App quitting...');
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
