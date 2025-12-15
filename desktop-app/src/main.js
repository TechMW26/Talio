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
    
    // Request permissions after window is shown
    setTimeout(() => {
      permissionHandler.requestAllPermissions();
    }, 2000);
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

// IPC Handlers
ipcMain.handle('get-auth-token', () => {
  return store.get('authToken');
});

ipcMain.handle('set-auth-token', (event, token) => {
  store.set('authToken', token);
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
