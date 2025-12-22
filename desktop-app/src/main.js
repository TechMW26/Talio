/**
 * Talio Desktop App v3.1.0
 * 
 * Main process - handles window, tray, and screenshot capture
 * Screenshots are uploaded directly to MongoDB GridFS
 * 
 * Features:
 * - Deep link protocol (talio://) for OAuth callback
 * - Location permission for geofencing
 * - External browser Google OAuth
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, shell, Notification, systemPreferences, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const screenshotService = require('./screenshotService');
const debugLogger = require('./debugLogger');
const { PermissionHandler } = require('./permissionHandler');

// Constants
const APP_URL = 'https://app.talio.in';
const PROTOCOL_NAME = 'talio';
const store = new Store();

// Global references
let mainWindow = null;
let tray = null;
let permissionHandler = null;
let isQuitting = false;
let hasDetectedLogin = false;
let loginCheckInterval = null;
let networkRetryInterval = null;
let healthCheckInterval = null;
let currentUserRole = null;
let currentUserId = null;

// Tray states
const TRAY_STATES = {
  IDLE: 'idle',           // Gray - not capturing
  HEALTHY: 'healthy',     // Green - capturing normally
  WARNING: 'warning',     // Yellow - offline or issues
  ERROR: 'error'          // Red - failed
};
let currentTrayState = TRAY_STATES.IDLE;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Register deep link protocol (talio://)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_NAME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_NAME);
}

// Handle deep link on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  debugLogger.log('info', 'DeepLink', `Received: ${url}`);
  handleDeepLink(url);
});

app.on('second-instance', (event, commandLine) => {
  // Handle deep link on Windows (passed as command line argument)
  const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL_NAME}://`));
  if (url) {
    debugLogger.log('info', 'DeepLink', `Received from second instance: ${url}`);
    handleDeepLink(url);
  }
  
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

/**
 * Handle deep link URLs (talio://auth?token=xxx)
 */
function handleDeepLink(url) {
  try {
    const parsedUrl = new URL(url);
    const action = parsedUrl.hostname || parsedUrl.pathname.replace(/^\/+/, '');
    
    debugLogger.log('info', 'DeepLink', `Action: ${action}`);
    
    if (action === 'auth' || action === 'callback') {
      // OAuth callback
      const token = parsedUrl.searchParams.get('token');
      const error = parsedUrl.searchParams.get('error');
      
      if (error) {
        debugLogger.log('error', 'DeepLink', `OAuth error: ${error}`);
        if (mainWindow) {
          mainWindow.webContents.executeJavaScript(`
            window.dispatchEvent(new CustomEvent('talio-oauth-error', { detail: { error: '${error}' } }));
          `);
        }
        return;
      }
      
      if (token) {
        debugLogger.log('info', 'DeepLink', 'OAuth token received, storing...');
        store.set('authToken', token);
        
        // Inject token into the web app
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          
          // Store token and reload to authenticated state
          mainWindow.webContents.executeJavaScript(`
            localStorage.setItem('token', '${token}');
            window.dispatchEvent(new CustomEvent('talio-oauth-success', { detail: { token: '${token}' } }));
            // Redirect to dashboard
            if (window.location.pathname === '/login' || window.location.pathname === '/') {
              window.location.href = '/dashboard';
            }
          `);
        }
      }
    } else if (action === 'open') {
      // Just open the app
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  } catch (error) {
    debugLogger.log('error', 'DeepLink', `Parse error: ${error.message}`);
  }
}

/**
 * Get color for tray state
 */
function getStateColor(state) {
  switch (state) {
    case TRAY_STATES.HEALTHY: return '#22c55e';  // Green
    case TRAY_STATES.WARNING: return '#eab308';  // Yellow
    case TRAY_STATES.ERROR: return '#ef4444';    // Red
    default: return '#9ca3af';                    // Gray
  }
}

/**
 * Create simple colored tray icon using native image
 */
function createTrayIcon(state) {
  // Try to use pre-built icon first
  const iconPath = path.join(__dirname, '..', 'build', `tray-${state}.png`);
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 });
    }
  } catch {}

  // Fallback to default icon
  const defaultPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  try {
    const icon = nativeImage.createFromPath(defaultPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 });
    }
  } catch {}

  return nativeImage.createEmpty();
}

/**
 * Update tray icon and tooltip
 */
function setTrayState(state) {
  if (currentTrayState === state) return;
  currentTrayState = state;

  if (tray) {
    const icon = createTrayIcon(state);
    tray.setImage(icon);

    const tooltips = {
      [TRAY_STATES.IDLE]: 'Talio - Idle',
      [TRAY_STATES.HEALTHY]: 'Talio - Active',
      [TRAY_STATES.WARNING]: 'Talio - Offline',
      [TRAY_STATES.ERROR]: 'Talio - Error'
    };
    tray.setToolTip(tooltips[state] || 'Talio');
  }

  debugLogger.log('info', 'Tray', `State changed to: ${state}`);
}

/**
 * Flash tray icon briefly on capture
 */
function flashTrayCapture() {
  if (!tray) return;
  
  // Quick visual feedback - no text notification
  const originalState = currentTrayState;
  setTrayState(TRAY_STATES.HEALTHY);
  
  setTimeout(() => {
    // Return to original or appropriate state
    setTrayState(originalState);
  }, 500);
}

/**
 * Check screen recording permission (macOS)
 */
async function checkScreenPermission() {
  if (process.platform !== 'darwin') {
    return true;
  }

  const status = systemPreferences.getMediaAccessStatus('screen');
  debugLogger.log('info', 'Permission', `Screen permission status: ${status}`);

  if (status === 'granted') {
    return true;
  }

  // Show permission dialog
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Screen Recording Permission Required',
    message: 'Talio needs screen recording permission to capture screenshots for productivity monitoring.',
    detail: 'Please click "Open System Settings" and enable screen recording for Talio in Privacy & Security settings.',
    buttons: ['Open System Settings', 'Later'],
    defaultId: 0
  });

  if (result.response === 0) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }

  return false;
}

/**
 * Request location permission
 * On macOS: Uses native permission dialog
 * On Windows: Uses Geolocation API (permission handled by OS)
 */
async function requestLocationPermission() {
  debugLogger.log('info', 'Permission', 'Requesting location permission...');
  
  if (process.platform === 'darwin') {
    // macOS: Check and request location permission
    const status = systemPreferences.getMediaAccessStatus('location');
    debugLogger.log('info', 'Permission', `Location permission status: ${status}`);
    
    if (status === 'granted') {
      return { granted: true };
    }
    
    if (status === 'denied') {
      // Show dialog to open settings
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Location Permission Required',
        message: 'Talio needs location access for attendance geofencing.',
        detail: 'Please enable location access for Talio in System Settings > Privacy & Security > Location Services.',
        buttons: ['Open System Settings', 'Cancel'],
        defaultId: 0
      });
      
      if (result.response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices');
      }
      
      return { granted: false, reason: 'denied' };
    }
    
    // Status is 'not-determined' - need to trigger the native prompt
    // On macOS, we trigger location request via the renderer process
    return { granted: false, reason: 'not-determined', needsPrompt: true };
  }
  
  // Windows: Location permission is handled by the OS when geolocation is requested
  // We'll let the renderer handle it via navigator.geolocation
  return { granted: true, platform: 'windows' };
}

/**
 * Get current location
 * Returns location coordinates for geofencing
 */
async function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve({ error: 'No window available' });
      return;
    }
    
    // Use renderer process to get location (has access to navigator.geolocation)
    mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({ error: 'Geolocation not supported' });
          return;
        }
        
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp
            });
          },
          (error) => {
            resolve({ error: error.message, code: error.code });
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          }
        );
      });
    `).then(resolve).catch(err => resolve({ error: err.message }));
  });
}

/**
 * Open Google OAuth in system browser
 */
function openGoogleOAuth() {
  // Build OAuth URL that will redirect back to our deep link
  const callbackUrl = encodeURIComponent(`${APP_URL}/api/auth/desktop-callback`);
  const oauthUrl = `${APP_URL}/api/auth/google?desktop=true&callback=${callbackUrl}`;
  
  debugLogger.log('info', 'OAuth', `Opening Google OAuth in browser: ${oauthUrl}`);
  
  // Open in system default browser
  shell.openExternal(oauthUrl);
  
  return { opened: true };
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
 * Show offline page
 */
function showOfflinePage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  setTrayState(TRAY_STATES.WARNING);

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
        p { font-size: 16px; color: #666; margin-bottom: 24px; text-align: center; }
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
 * Start network retry when offline
 */
function startNetworkRetry() {
  if (networkRetryInterval) return;

  networkRetryInterval = setInterval(async () => {
    try {
      const response = await fetch(`${APP_URL}/api/health`, { method: 'HEAD' });
      if (response.ok) {
        clearInterval(networkRetryInterval);
        networkRetryInterval = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(APP_URL);
          setTrayState(TRAY_STATES.IDLE);
        }
      }
    } catch {}
  }, 5000);
}

/**
 * Create main browser window
 */
function createWindow() {
  debugLogger.log('info', 'App', 'Creating main window...');
  
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

  // Handle load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    debugLogger.log('error', 'Window', `Load failed: ${errorCode} - ${errorDescription}`);
    if ([-106, -105, -102, -118].includes(errorCode)) {
      showOfflinePage();
      startNetworkRetry();
    }
  });

  // When page loads, close loading window and check permissions
  mainWindow.webContents.on('did-finish-load', async () => {
    debugLogger.log('info', 'Window', 'Page finished loading');
    
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    // Windows and Linux: Skip permission screen entirely, permissions are handled by OS
    if (process.platform === 'win32' || process.platform === 'linux') {
      debugLogger.log('info', 'Permissions', 'Windows/Linux - skipping permission screen, OS handles permissions');
      startLoginDetection();
      return;
    }
    
    // macOS: Initialize permission handler and check permissions
    if (!permissionHandler) {
      permissionHandler = new PermissionHandler(mainWindow);
      
      // Set callback for when permissions are granted (from setup screen)
      permissionHandler.setOnPermissionsGranted(() => {
        debugLogger.log('info', 'Permissions', 'All permissions granted via setup screen, starting login detection');
        // Don't start login detection here - it will be triggered after the app reloads
      });
    }
    
    // Check if we're on a permission setup screen (data: URL)
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl.startsWith('data:')) {
      debugLogger.log('info', 'Permissions', 'On permission setup screen, skipping login detection');
      return;
    }
    
    // Check if all permissions are already granted
    await permissionHandler.checkAllPermissions();
    const allGranted = permissionHandler.areAllPermissionsGranted();
    
    if (allGranted) {
      debugLogger.log('info', 'Permissions', 'All permissions granted, starting login detection');
      startLoginDetection();
    } else {
      // Request all permissions - will show setup screen if any are missing
      const granted = await permissionHandler.requestAllPermissions();
      
      if (granted) {
        debugLogger.log('info', 'Permissions', 'Permissions granted, starting login detection');
        startLoginDetection();
      } else {
        debugLogger.log('info', 'Permissions', 'Waiting for permissions to be granted...');
        // Login detection will start after permissions are granted and app reloads
      }
    }
  });

  // Handle new window requests (open in browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Window close behavior
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the app
  mainWindow.loadURL(APP_URL);
}

/**
 * Create system tray
 */
function createTray() {
  const icon = createTrayIcon(TRAY_STATES.IDLE);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Talio',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Capture Status',
      enabled: false,
      id: 'status'
    },
    { type: 'separator' },
    {
      label: 'View Logs',
      click: () => {
        const logPath = debugLogger.getLogPath();
        shell.openPath(logPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Talio',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Talio');

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

/**
 * Update tray menu status text
 */
function updateTrayStatus(text) {
  if (!tray) return;

  const menu = tray.getContextMenu();
  if (menu) {
    const statusItem = menu.items.find(item => item.id === 'status');
    if (statusItem) {
      statusItem.label = text;
    }
  }
}

/**
 * Extract auth data from cookies/localStorage
 */
async function extractAuthData() {
  if (!mainWindow) return null;

  try {
    // Try to get JWT from cookies first
    const cookies = await session.fromPartition('persist:talio').cookies.get({ url: APP_URL });
    const tokenCookie = cookies.find(c => c.name === 'token' || c.name === 'auth-token');

    if (tokenCookie?.value) {
      debugLogger.log('info', 'Auth', 'Found auth token in cookies');
      return tokenCookie.value;
    }

    // Try localStorage
    const localStorageData = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          return localStorage.getItem('token') || localStorage.getItem('auth-token') || null;
        } catch { return null; }
      })()
    `);

    if (localStorageData) {
      debugLogger.log('info', 'Auth', 'Found auth token in localStorage');
      return localStorageData;
    }

    return null;
  } catch (error) {
    debugLogger.log('error', 'Auth', `Failed to extract auth data: ${error.message}`);
    return null;
  }
}

/**
 * Check if user is logged in
 */
async function checkLoginStatus() {
  if (!mainWindow) return { loggedIn: false };

  try {
    const result = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          const url = window.location.href;
          const pathname = window.location.pathname;
          
          // Check URL patterns
          const isLoginPage = pathname.includes('/login') || pathname === '/';
          const isDashboard = pathname.includes('/dashboard');
          
          // Try to get user data
          let userData = null;
          try {
            const stored = localStorage.getItem('user') || sessionStorage.getItem('user');
            if (stored) userData = JSON.parse(stored);
          } catch {}
          
          return {
            url,
            pathname,
            isLoginPage,
            isDashboard,
            hasUserData: !!userData,
            userId: userData?.id || userData?._id || null,
            userRole: userData?.role || null,
            userName: userData?.name || null
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `);

    const loggedIn = result.isDashboard || result.hasUserData;

    return {
      loggedIn,
      ...result
    };
  } catch (error) {
    debugLogger.log('error', 'Auth', `Login check failed: ${error.message}`);
    return { loggedIn: false, error: error.message };
  }
}

/**
 * Start screenshot capture service
 */
async function startCaptureService(authToken, userId, userRole) {
  // Don't capture for admin roles
  if (['admin'].includes(userRole)) {
    debugLogger.log('info', 'Capture', 'Skipping capture for admin role');
    setTrayState(TRAY_STATES.IDLE);
    updateTrayStatus('Capture: Disabled (Admin)');
    return;
  }

  // Check screen permission
  const hasPermission = await checkScreenPermission();
  if (!hasPermission) {
    debugLogger.log('warn', 'Capture', 'Screen recording permission not granted');
    setTrayState(TRAY_STATES.WARNING);
    updateTrayStatus('Capture: Permission Required');
    return;
  }

  // Initialize screenshot service
  screenshotService.initialize(APP_URL, authToken);

  // Set up callbacks
  screenshotService.onCapture((data) => {
    debugLogger.log('info', 'Capture', `Screenshot captured: ${data.screenshotId} (Total: ${data.captureCount})`);
    flashTrayCapture();
    setTrayState(TRAY_STATES.HEALTHY);
    updateTrayStatus(`Capture: Active (${data.captureCount} today)`);
  });

  screenshotService.onError((error) => {
    debugLogger.log('error', 'Capture', `Error: ${error.message}`);
    
    if (error.type === 'offline') {
      setTrayState(TRAY_STATES.WARNING);
      updateTrayStatus('Capture: Offline');
    } else {
      setTrayState(TRAY_STATES.ERROR);
      updateTrayStatus(`Capture: Error`);
    }
  });

  // Start capturing
  screenshotService.start();
  setTrayState(TRAY_STATES.HEALTHY);
  updateTrayStatus('Capture: Active');

  debugLogger.log('info', 'Capture', 'Screenshot service started');
}

/**
 * Handle detected login
 */
async function handleLogin(loginData) {
  if (hasDetectedLogin) return;
  hasDetectedLogin = true;

  debugLogger.log('info', 'Auth', `Login detected: ${loginData.userName || 'Unknown'} (${loginData.userRole || 'Unknown'})`);

  currentUserId = loginData.userId;
  currentUserRole = loginData.userRole;

  // Save to store
  store.set('lastUserId', currentUserId);
  store.set('lastUserRole', currentUserRole);

  // Get auth token
  const authToken = await extractAuthData();
  if (!authToken) {
    debugLogger.log('error', 'Auth', 'Could not extract auth token');
    return;
  }

  // Start capture service
  await startCaptureService(authToken, currentUserId, currentUserRole);
}

/**
 * Handle logout
 */
function handleLogout() {
  debugLogger.log('info', 'Auth', 'Logout detected');

  hasDetectedLogin = false;
  currentUserId = null;
  currentUserRole = null;

  // Stop capture service
  screenshotService.stop();

  // Clear stored data
  store.delete('lastUserId');
  store.delete('lastUserRole');

  setTrayState(TRAY_STATES.IDLE);
  updateTrayStatus('Capture: Idle');
}

/**
 * Start login detection polling
 */
function startLoginDetection() {
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval);
  }

  // Check immediately
  checkAndHandleLogin();

  // Then check every 3 seconds
  loginCheckInterval = setInterval(checkAndHandleLogin, 3000);
}

/**
 * Check login status and handle accordingly
 */
async function checkAndHandleLogin() {
  const status = await checkLoginStatus();

  if (status.loggedIn && !hasDetectedLogin) {
    await handleLogin(status);
  } else if (!status.loggedIn && hasDetectedLogin) {
    handleLogout();
  }
}

/**
 * App ready handler
 */
app.whenReady().then(async () => {
  debugLogger.log('info', 'App', 'Talio Desktop v3.1.0 starting...');

  createTray();
  createWindow();

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

/**
 * Before quit handler
 */
app.on('before-quit', () => {
  isQuitting = true;

  // Stop services
  screenshotService.stop();
  
  // Stop permission monitoring
  if (permissionHandler) {
    permissionHandler.stopPermissionMonitoring();
  }

  // Clear intervals
  if (loginCheckInterval) clearInterval(loginCheckInterval);
  if (networkRetryInterval) clearInterval(networkRetryInterval);
  if (healthCheckInterval) clearInterval(healthCheckInterval);

  debugLogger.log('info', 'App', 'Shutting down...');
});

/**
 * All windows closed handler
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * IPC Handlers
 */
ipcMain.handle('get-capture-status', () => {
  return screenshotService.getStatus();
});

ipcMain.handle('get-health', async () => {
  return screenshotService.healthCheck();
});

ipcMain.handle('force-capture', async () => {
  return screenshotService.captureAndUpload();
});

// Location permission handlers
ipcMain.handle('request-location-permission', async () => {
  return requestLocationPermission();
});

ipcMain.handle('get-current-location', async () => {
  return getCurrentLocation();
});

// OAuth handlers
ipcMain.handle('open-google-oauth', () => {
  return openGoogleOAuth();
});

// Open external URL in system browser
ipcMain.handle('open-external-url', async (event, url) => {
  if (!url || typeof url !== 'string') {
    return { opened: false, error: 'Invalid URL' };
  }
  
  debugLogger.log('info', 'External', `Opening URL: ${url}`);
  await shell.openExternal(url);
  return { opened: true };
});

// Check if user is logged in via deep link
ipcMain.handle('check-auth-token', () => {
  const token = store.get('authToken');
  return { hasToken: !!token, token };
});

// Clear stored auth token
ipcMain.handle('clear-auth-token', () => {
  store.delete('authToken');
  return { cleared: true };
});

// Permission handlers
ipcMain.handle('get-permission-status', async () => {
  if (permissionHandler) {
    await permissionHandler.checkAllPermissions();
    return permissionHandler.getStatus();
  }
  return { permissions: {}, allGranted: false };
});

ipcMain.handle('grant-all-permissions', async () => {
  if (permissionHandler) {
    return await permissionHandler.grantAllPermissions();
  }
  return { error: 'Permission handler not initialized' };
});

ipcMain.handle('check-permissions', async () => {
  if (permissionHandler) {
    await permissionHandler.checkAllPermissions();
    return permissionHandler.getStatus();
  }
  return { permissions: {}, allGranted: false };
});

ipcMain.handle('retry-permissions', async () => {
  if (permissionHandler) {
    return await permissionHandler.requestAllPermissions();
  }
  return false;
});

ipcMain.handle('open-system-preferences', async (event, section) => {
  if (permissionHandler) {
    permissionHandler.openSystemPreferences(section || 'screen');
  } else {
    // Fallback - open general privacy settings
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy');
    }
  }
  return { opened: true };
});
