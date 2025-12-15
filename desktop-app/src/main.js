const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, systemPreferences, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { ScreenshotService } = require('./screenshotService');
const { PermissionHandler } = require('./permissionHandler');

// Constants
const APP_URL = 'https://app.talio.in';
const store = new Store();

// Global references
let mainWindow = null;
let tray = null;
let screenshotService = null;
let permissionHandler = null;
let isQuitting = false;
let hasDetectedLogin = false;
let loginCheckInterval = null;

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
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#ffffff',
    show: false,
    frame: true, // Keep native frame with close/minimize buttons
    titleBarStyle: 'default', // Don't merge with top bar
    autoHideMenuBar: true, // Hide menu bar (no toolbars)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:talio', // Persist session data for Google login
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Enable media features for meetings
      backgroundThrottling: false
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png')
  });

  // Remove default menu
  mainWindow.setMenu(null);

  // Load the app URL
  mainWindow.loadURL(APP_URL);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Start periodic login check as fallback
    startLoginCheck();
  });

  // Detect navigation to dashboard (login success)
  mainWindow.webContents.on('did-navigate', (event, url) => {
    checkForLoginSuccess(url);
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    checkForLoginSuccess(url);
  });

  // Also check after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
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
    // Allow same-origin popups (for Google OAuth)
    if (url.includes('accounts.google.com') || url.includes('talio.in')) {
      return { action: 'allow' };
    }
    // Open other links in default browser
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
    // Show native screen picker
    require('electron').desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      // Return the first source (primary screen) or let user choose
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
 * Create system tray
 */
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  let trayIcon;
  
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Fallback: create a simple icon
      trayIcon = nativeImage.createEmpty();
    }
    // Resize for tray (16x16 on most platforms)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Talio');

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
      label: 'Status: Running',
      enabled: false
    }
    // Note: No quit option as per requirements
  ]);

  tray.setContextMenu(contextMenu);

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
 * Initialize the application
 */
async function initialize() {
  // Create window and tray
  createWindow();
  createTray();

  // Initialize permission handler
  permissionHandler = new PermissionHandler(mainWindow);

  // Initialize screenshot service
  screenshotService = new ScreenshotService({
    apiUrl: `${APP_URL}/api/activity/screenshot`,
    clockStatusUrl: `${APP_URL}/api/activity/clock-status`,
    getAuthToken: () => store.get('authToken'),
    interval: 60000 // 1 minute
  });

  // Start screenshot service
  screenshotService.start();

  // Setup auto-launch on boot
  setupAutoLaunch();
}

/**
 * Setup auto-launch on system boot
 */
function setupAutoLaunch() {
  const settings = {
    openAtLogin: true,
    openAsHidden: true // Start minimized to tray
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
function onLoginSuccess(source) {
  if (hasDetectedLogin) return;
  
  hasDetectedLogin = true;
  console.log(`[Login Detection] Login detected via: ${source}`);
  
  // Clear the periodic check
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval);
    loginCheckInterval = null;
  }
  
  // Request all permissions after short delay
  setTimeout(() => {
    console.log('[Permissions] Requesting all permissions after login...');
    permissionHandler.requestAllPermissions();
  }, 1500);
  
  // Force screenshot capture after permissions
  setTimeout(() => {
    if (screenshotService) {
      console.log('[Screenshots] Triggering initial screenshot capture...');
      screenshotService.forceCapture();
    }
  }, 5000);
}

/**
 * Start periodic check for login (fallback)
 */
function startLoginCheck() {
  // Check every 10 seconds for login state
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
  // Token being set indicates login success
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
  return true;
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
      // This will prompt for screen recording permission
      const { desktopCapturer } = require('electron');
      await desktopCapturer.getSources({ types: ['screen'] });
    }
    return systemPreferences.getMediaAccessStatus('screen');
  }
  return 'granted';
});

// Screenshot service IPC handlers for debugging
ipcMain.handle('get-screenshot-status', () => {
  return screenshotService?.getStatus() || { error: 'Service not initialized' };
});

ipcMain.handle('force-screenshot', async () => {
  if (!screenshotService) {
    return { success: false, error: 'Service not initialized' };
  }
  return await screenshotService.forceCapture();
});

ipcMain.handle('restart-screenshot-service', () => {
  if (screenshotService) {
    screenshotService.stop();
    screenshotService.start();
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

// App event handlers
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  // Don't quit on window close - keep running in tray
});

app.on('activate', () => {
  // On macOS, re-create window if dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  screenshotService?.stop();
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
