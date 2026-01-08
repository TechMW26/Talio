/**
 * Talio Desktop App v4.0.0
 * Main Electron process
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const logger = require('./logger');
const screenshotService = require('./screenshotService');
const socketHandler = require('./socketHandler');

// CRITICAL: Disable GPU hardware acceleration to prevent renderer crashes
// This helps with SIGSEGV (exit code 11) issues
app.disableHardwareAcceleration();

// Stability flags for Electron
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

// Note: The actual fix for the "Checking session" crash loop requires
// deploying the Providers.js fix to production (app.talio.in)
// which disables AudioContext initialization for desktop apps

// Configuration
const APP_URL = 'https://app.talio.in';
const LOADER_TIMEOUT_MS = 30000; // 30 seconds max loading time
const RETRY_DELAY_MS = 5000;
const MAX_LOAD_RETRIES = 3;
const MAX_CRASH_RECOVERY = 3; // Max crash recovery attempts

// Global references
let mainWindow = null;
let tray = null;
let isQuitting = false;
let loadRetries = 0;
let loadTimeout = null;
let isAuthenticated = false;
let userData = null;
let crashCount = 0;
let lastCrashTime = 0;

// Persistent store
const store = new Store({ name: 'app-data' });

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Talio',
  isHidden: true
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', function() {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  const windowBounds = store.get('windowBounds', { width: 1280, height: 800 });
  
  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Enable DevTools for debugging
      devTools: true,
      // Stability options
      backgroundThrottling: false,
      offscreen: false,
      // Disable experimental features that may cause crashes
      experimentalFeatures: false
    },
    icon: getAppIcon(),
    show: false, // Don't show until ready-to-show
    backgroundColor: '#1a1a2e', // Talio dark theme
    autoHideMenuBar: true
    // Removed titleBarStyle and titleBarOverlay - causes blank screen issues
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', function() {
    mainWindow.show();
    logger.log('info', 'Main', 'Window ready-to-show triggered');
  });

  // Log renderer console messages for debugging
  mainWindow.webContents.on('console-message', function(event, level, message, line, sourceId) {
    if (level >= 2) { // warnings and errors
      logger.log('warn', 'Renderer', message);
    }
  });

  // Handle render process crashes - with recovery limit to prevent infinite loop
  mainWindow.webContents.on('render-process-gone', function(event, details) {
    const now = Date.now();
    logger.log('error', 'Main', 'Render process gone: ' + details.reason + ' (exitCode: ' + details.exitCode + ')');
    
    // Reset crash count if more than 30 seconds since last crash
    if (now - lastCrashTime > 30000) {
      crashCount = 0;
    }
    lastCrashTime = now;
    crashCount++;
    
    if (crashCount <= MAX_CRASH_RECOVERY && mainWindow && !mainWindow.isDestroyed()) {
      logger.log('warn', 'Main', 'Attempting crash recovery (' + crashCount + '/' + MAX_CRASH_RECOVERY + ')');
      // Wait a bit before reloading to let things settle
      setTimeout(function() {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(APP_URL);
        }
      }, 2000);
    } else {
      logger.log('error', 'Main', 'Max crash recovery attempts reached, showing error page');
      showCrashPage();
    }
  });

  // Handle unresponsive page
  mainWindow.webContents.on('unresponsive', function() {
    logger.log('warn', 'Main', 'Page became unresponsive');
  });

  mainWindow.webContents.on('responsive', function() {
    logger.log('info', 'Main', 'Page became responsive');
  });

  // Show loader first, then load app
  showLoader();
  
  // Setup window events
  setupWindowEvents();
  
  // Setup IPC handlers
  setupIPCHandlers();
  
  logger.log('info', 'Main', 'Window created');
}

/**
 * Show loading screen while app loads
 */
function showLoader() {
  const loaderHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Talio</title><style>' +
    'body{margin:0;padding:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}' +
    '.container{text-align:center;color:#fff}' +
    '.logo{width:80px;height:80px;margin:0 auto 20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:bold}' +
    '.spinner{width:40px;height:40px;margin:20px auto;border:3px solid rgba(255,255,255,0.2);border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '.status{color:rgba(255,255,255,0.6);font-size:14px;margin-top:10px}' +
    '.error{color:#f87171;display:none}' +
    '.retry-btn{background:#6366f1;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;margin-top:15px;display:none}' +
    '.retry-btn:hover{background:#4f46e5}' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="logo">T</div>' +
    '<h2>Talio</h2>' +
    '<div class="spinner" id="spinner"></div>' +
    '<p class="status" id="status">Connecting...</p>' +
    '<p class="error" id="error">Connection failed. Please check your internet.</p>' +
    '<button class="retry-btn" id="retry" onclick="location.reload()">Retry</button>' +
    '</div></body></html>';
  
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loaderHTML));
  
  // Show window immediately for loader (bypass ready-to-show for data URL)
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  
  // Start loading app after a short delay
  setTimeout(loadApp, 1000);
}

/**
 * Load the main application
 */
function loadApp() {
  loadRetries++;
  logger.log('info', 'Main', 'Loading app (attempt ' + loadRetries + '/' + MAX_LOAD_RETRIES + ')');
  
  // Set timeout for loading
  clearTimeout(loadTimeout);
  loadTimeout = setTimeout(function() {
    handleLoadTimeout();
  }, LOADER_TIMEOUT_MS);
  
  mainWindow.loadURL(APP_URL).then(function() {
    clearTimeout(loadTimeout);
    loadRetries = 0;
    logger.log('info', 'Main', 'App loaded successfully');
  }).catch(function(error) {
    logger.log('error', 'Main', 'Load failed: ' + error.message);
    handleLoadError(error);
  });
}

/**
 * Handle load timeout
 */
function handleLoadTimeout() {
  logger.log('warn', 'Main', 'Load timeout reached');
  // Keep retrying indefinitely - let server handle offline state
  setTimeout(loadApp, RETRY_DELAY_MS);
}

/**
 * Handle load error
 */
function handleLoadError(error) {
  clearTimeout(loadTimeout);
  logger.log('info', 'Main', 'Retrying in ' + (RETRY_DELAY_MS / 1000) + 's...');
  // Keep retrying indefinitely - let server handle offline state
  setTimeout(loadApp, RETRY_DELAY_MS);
}

/**
 * Show offline page when can't connect
 * Includes auto-reconnect that polls every 3 seconds
 */
function showOfflinePage() {
  const offlineHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Talio - Offline</title><style>' +
    'body{margin:0;padding:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}' +
    '.container{text-align:center;color:#fff;max-width:400px;padding:20px}' +
    '.icon{font-size:64px;margin-bottom:20px}' +
    'h2{margin:10px 0}' +
    'p{color:rgba(255,255,255,0.6);line-height:1.6}' +
    '.status-box{background:rgba(255,255,255,0.1);border-radius:12px;padding:16px;margin:24px 0;display:flex;align-items:center;justify-content:center;gap:12px}' +
    '.spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '.status-text{font-size:14px;color:rgba(255,255,255,0.8)}' +
    '.retry-btn{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;margin-top:10px;font-size:16px;transition:background 0.2s}' +
    '.retry-btn:hover{background:#4f46e5}' +
    '.success{color:#22c55e}' +
    '.success .spinner{border-top-color:#22c55e;animation:none;border:2px solid #22c55e}' +
    '.success .spinner:after{content:"✓";display:block;text-align:center;line-height:16px}' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="icon">📡</div>' +
    '<h2>Unable to Connect</h2>' +
    '<p>We could not connect to Talio servers. Please check your internet connection.</p>' +
    '<div class="status-box" id="status">' +
    '<div class="spinner"></div>' +
    '<span class="status-text">Checking connection...</span>' +
    '</div>' +
    '<button class="retry-btn" onclick="location.reload()">Try Again Now</button>' +
    '</div>' +
    '<script>' +
    '(function(){' +
    'var attempts=0;var maxAttempts=200;var interval=3000;' +
    'function updateStatus(msg,success){' +
    'var el=document.getElementById("status");' +
    'if(success){el.classList.add("success");}' +
    'el.querySelector(".status-text").textContent=msg;' +
    '}' +
    'function check(){' +
    'attempts++;' +
    'updateStatus("Checking connection... ("+attempts+")",false);' +
    'fetch("https://app.talio.in/api/health",{method:"GET",cache:"no-store"})' +
    '.then(function(r){' +
    'if(r.ok){' +
    'updateStatus("Connected! Reloading...",true);' +
    'setTimeout(function(){' +
    'var lastUrl=localStorage.getItem("talio_last_url");' +
    'if(lastUrl&&!lastUrl.includes("/offline")&&lastUrl.startsWith("https://app.talio.in")){' +
    'window.location.href=lastUrl;' +
    '}else{window.location.href="https://app.talio.in/dashboard";}' +
    '},1500);' +
    '}else{scheduleNext();}' +
    '}).catch(function(){scheduleNext();});' +
    '}' +
    'function scheduleNext(){' +
    'if(attempts<maxAttempts){setTimeout(check,interval);}' +
    'else{updateStatus("Connection check paused. Click Try Again.",false);}' +
    '}' +
    'setTimeout(check,1000);' +
    '})();' +
    '</script>' +
    '</body></html>';
  
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offlineHTML));
  logger.log('info', 'Main', 'Showing offline page with auto-reconnect');
}

/**
 * Show crash page when renderer keeps crashing
 */
function showCrashPage() {
  const crashHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Talio - Error</title><style>' +
    'body{margin:0;padding:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}' +
    '.container{text-align:center;color:#fff;max-width:400px;padding:20px}' +
    '.icon{font-size:64px;margin-bottom:20px}' +
    'h2{margin:10px 0}' +
    'p{color:rgba(255,255,255,0.6);line-height:1.6}' +
    '.retry-btn{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;margin-top:20px;font-size:16px}' +
    '.retry-btn:hover{background:#4f46e5}' +
    '.secondary-btn{background:transparent;color:#6366f1;border:1px solid #6366f1;padding:12px 24px;border-radius:8px;cursor:pointer;margin-top:10px;font-size:14px;margin-left:10px}' +
    '</style></head><body>' +
    '<div class="container">' +
    '<div class="icon">⚠️</div>' +
    '<h2>Something Went Wrong</h2>' +
    '<p>The app encountered an error and needs to restart. If this keeps happening, try restarting your computer.</p>' +
    '<button class="retry-btn" onclick="window.electronAPI ? window.electronAPI.restartApp() : location.reload()">Restart App</button>' +
    '</div></body></html>';
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(crashHTML));
  }
  logger.log('info', 'Main', 'Showing crash page');
}

/**
 * Setup window events
 */
function setupWindowEvents() {
  mainWindow.on('close', function(event) {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
  
  mainWindow.on('closed', function() {
    mainWindow = null;
  });
  
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);
  
  // Handle navigation - did-finish-load fires for successful loads
  mainWindow.webContents.on('did-finish-load', function() {
    const url = mainWindow.webContents.getURL();
    logger.log('info', 'Main', 'Page loaded: ' + url);
    
    // Only inject auth listener for actual app pages, not data URLs
    if (url.startsWith('https://app.talio.in')) {
      injectAuthListener();
    }
  });
  
  // Handle page load failures
  mainWindow.webContents.on('did-fail-load', function(event, errorCode, errorDescription, validatedURL, isMainFrame) {
    if (isMainFrame) {
      logger.log('error', 'Main', 'Page failed to load: ' + errorDescription + ' (' + errorCode + ') - ' + validatedURL);
      
      // Show offline page for network errors
      if (errorCode === -106 || errorCode === -105 || errorCode === -102) {
        showOfflinePage();
      }
    }
  });

  // Handle DOM ready - page is interactive but might still be loading resources
  // CRITICAL: Inject audio disable script here BEFORE React hydration completes
  mainWindow.webContents.on('dom-ready', function() {
    logger.log('info', 'Main', 'DOM ready');
    
    // Inject AudioContext disable as early as possible
    const url = mainWindow.webContents.getURL();
    if (url.startsWith('https://app.talio.in')) {
      injectAudioDisable();
    }
  });
  
  // Handle new window requests (open in browser)
  mainWindow.webContents.setWindowOpenHandler(function(details) {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
  
  // Handle certificate errors gracefully
  mainWindow.webContents.on('certificate-error', function(event, url, error, cert, callback) {
    logger.log('warn', 'Main', 'Certificate error: ' + error);
    callback(false);
  });
}

/**
 * Save window bounds for next launch
 */
function saveWindowBounds() {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  }
}

/**
 * Inject AudioContext disable to prevent renderer crashes
 * MUST be called at dom-ready, before React hydration
 */
function injectAudioDisable() {
  const disableAudioScript = '(' + (function() {
    // CRITICAL: Disable AudioContext to prevent renderer crashes in Electron
    // This must run before any audio initialization
    if (window.__TALIO_AUDIO_DISABLED__) return;
    window.__TALIO_AUDIO_DISABLED__ = true;
    
    try {
      var OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
      
      window.AudioContext = function() {
        console.log('[Talio Desktop] AudioContext disabled for stability');
        return {
          state: 'suspended',
          sampleRate: 44100,
          destination: { channelCount: 2 },
          resume: function() { return Promise.resolve(); },
          suspend: function() { return Promise.resolve(); },
          close: function() { return Promise.resolve(); },
          createGain: function() { 
            return { 
              connect: function() { return this; }, 
              disconnect: function() {},
              gain: { value: 0, setValueAtTime: function() {} } 
            }; 
          },
          createBufferSource: function() { 
            return { 
              connect: function() { return this; }, 
              disconnect: function() {},
              start: function() {}, 
              stop: function() {},
              buffer: null
            }; 
          },
          createOscillator: function() {
            return {
              connect: function() { return this; },
              disconnect: function() {},
              start: function() {},
              stop: function() {},
              frequency: { value: 440 }
            };
          },
          decodeAudioData: function(buffer, success, error) { 
            if (error) error(new Error('AudioContext disabled in desktop app'));
            return Promise.reject(new Error('AudioContext disabled in desktop app')); 
          }
        };
      };
      window.webkitAudioContext = window.AudioContext;
      console.log('[Talio Desktop] AudioContext patched for stability');
    } catch (e) {
      console.warn('[Talio Desktop] Failed to patch AudioContext:', e);
    }
  }).toString() + ')()';
  
  mainWindow.webContents.executeJavaScript(disableAudioScript).catch(function(e) {
    logger.log('warn', 'Main', 'Failed to inject audio disable script: ' + e.message);
  });
}

/**
 * Inject authentication listener into the page
 */
function injectAuthListener() {
  const script = '(' + (function() {
    // Check for stored auth data
    function checkAuth() {
      try {
        var token = localStorage.getItem('token');
        var userStr = localStorage.getItem('user');
        if (token && userStr) {
          var user = JSON.parse(userStr);
          window.electronAPI.sendAuthData({ token: token, user: user });
        }
      } catch (e) {
        console.error('[Talio Desktop] Auth check error:', e);
      }
    }
    
    // Check immediately and on storage changes
    checkAuth();
    window.addEventListener('storage', checkAuth);
    
    // Also check periodically for initial load
    var checkCount = 0;
    var authInterval = setInterval(function() {
      checkAuth();
      checkCount++;
      if (checkCount > 10) clearInterval(authInterval);
    }, 1000);
  }).toString() + ')()';
  
  mainWindow.webContents.executeJavaScript(script).catch(function() {});
}

/**
 * Setup IPC handlers
 */
function setupIPCHandlers() {
  // App version
  ipcMain.handle('get-app-version', function() {
    return app.getVersion();
  });
  
  // Authentication
  ipcMain.handle('auth-data', function(event, data) {
    handleAuthentication(data);
    return { success: true };
  });
  
  ipcMain.handle('logout', function() {
    handleLogout();
    return { success: true };
  });
  
  // Screenshot service
  ipcMain.handle('start-capture', function() {
    return screenshotService.start();
  });
  
  ipcMain.handle('stop-capture', function() {
    screenshotService.stop();
    return { success: true };
  });
  
  ipcMain.handle('manual-capture', async function() {
    return await screenshotService.manualCapture();
  });
  
  ipcMain.handle('get-capture-status', function() {
    return screenshotService.getStatus();
  });
  
  ipcMain.handle('get-capture-stats', function() {
    return screenshotService.getStats();
  });
  
  ipcMain.handle('get-session-info', function() {
    var sessionManager = require('./sessionManager');
    return sessionManager.getSessionInfo();
  });
  
  // Network status
  ipcMain.handle('set-online-status', function(event, online) {
    screenshotService.setOnlineStatus(online);
    return { success: true };
  });
  
  // Window controls
  ipcMain.handle('minimize-window', function() {
    if (mainWindow) mainWindow.minimize();
    return { success: true };
  });
  
  ipcMain.handle('maximize-window', function() {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
    return { success: true };
  });
  
  ipcMain.handle('close-window', function() {
    if (mainWindow) mainWindow.hide();
    return { success: true };
  });
  
  // Notifications
  ipcMain.handle('show-notification', function(event, data) {
    showNotification(data.title, data.body);
    return { success: true };
  });
  
  // Restart app (for crash recovery)
  ipcMain.handle('restart-app', function() {
    logger.log('info', 'Main', 'Restart requested');
    crashCount = 0;
    app.relaunch();
    app.exit(0);
  });
}

/**
 * Handle authentication
 */
function handleAuthentication(data) {
  if (!data || !data.token || !data.user) {
    logger.log('warn', 'Main', 'Invalid auth data');
    return;
  }
  
  // Store auth data
  userData = data.user;
  store.set('userData', userData);
  store.set('authToken', data.token);
  isAuthenticated = true;
  
  logger.log('info', 'Main', 'Authenticated as ' + userData.email + ' (role: ' + userData.role + ')');
  
  // Initialize services
  screenshotService.initialize({
    userId: userData.userId || userData._id,
    employeeId: userData.employeeId,
    role: userData.role,
    token: data.token,
    mainWindow: mainWindow
  });
  
  // Initialize socket
  socketHandler.initialize(userData.userId || userData._id, data.token);
  
  // Setup socket callbacks
  socketHandler.on('screenshotRequest', function() {
    screenshotService.manualCapture();
  });
  
  socketHandler.on('notification', function(notif) {
    showNotification(notif.title, notif.message || notif.body);
    if (mainWindow) {
      mainWindow.webContents.send('notification', notif);
    }
  });
  
  socketHandler.on('connect', function() {
    if (mainWindow) {
      mainWindow.webContents.send('socket-status', { connected: true });
    }
  });
  
  socketHandler.on('disconnect', function() {
    if (mainWindow) {
      mainWindow.webContents.send('socket-status', { connected: false });
    }
  });
  
  // Start capture (only for non-admin users)
  if (userData.role !== 'admin') {
    screenshotService.start();
  } else {
    logger.log('info', 'Main', 'Admin user - screen capture disabled');
  }
  
  // Update tray menu
  updateTrayMenu();
}

/**
 * Handle logout
 */
function handleLogout() {
  logger.log('info', 'Main', 'User logged out');
  
  screenshotService.reset();
  socketHandler.reset();
  
  store.delete('userData');
  store.delete('authToken');
  
  isAuthenticated = false;
  userData = null;
  
  updateTrayMenu();
}

/**
 * Create system tray
 */
function createTray() {
  const icon = getAppIcon();
  tray = new Tray(icon);
  tray.setToolTip('Talio');
  
  updateTrayMenu();
  
  tray.on('click', function() {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  logger.log('info', 'Main', 'Tray created');
}

/**
 * Update tray context menu
 */
function updateTrayMenu() {
  var menuItems = [
    { label: 'Open Talio', click: function() { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' }
  ];
  
  if (isAuthenticated && userData) {
    menuItems.push({ label: 'Logged in as: ' + (userData.email || 'Unknown'), enabled: false });
    
    if (userData.role !== 'admin') {
      var status = screenshotService.getStatus();
      menuItems.push({
        label: status.isCapturing ? 'Pause Capture' : 'Resume Capture',
        click: function() {
          if (status.isCapturing) {
            screenshotService.stop();
          } else {
            screenshotService.start();
          }
          updateTrayMenu();
        }
      });
    }
    
    menuItems.push({ type: 'separator' });
  }
  
  menuItems.push(
    { label: 'Start at Login', type: 'checkbox', checked: store.get('autoLaunch', true), click: toggleAutoLaunch },
    { type: 'separator' },
    { label: 'Quit', click: function() { isQuitting = true; app.quit(); } }
  );
  
  var contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

/**
 * Toggle auto-launch setting
 */
async function toggleAutoLaunch(menuItem) {
  try {
    if (menuItem.checked) {
      await autoLauncher.enable();
      store.set('autoLaunch', true);
      logger.log('info', 'Main', 'Auto-launch enabled');
    } else {
      await autoLauncher.disable();
      store.set('autoLaunch', false);
      logger.log('info', 'Main', 'Auto-launch disabled');
    }
  } catch (error) {
    logger.log('error', 'Main', 'Auto-launch toggle failed: ' + error.message);
  }
}

/**
 * Show desktop notification
 */
function showNotification(title, body) {
  if (Notification.isSupported()) {
    var notification = new Notification({
      title: title || 'Talio',
      body: body || '',
      icon: getAppIcon()
    });
    notification.show();
  }
}

/**
 * Get app icon based on platform
 */
function getAppIcon() {
  var iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  var iconPath = path.join(__dirname, '..', 'build', iconName);
  try {
    return nativeImage.createFromPath(iconPath);
  } catch (e) {
    return null;
  }
}

/**
 * Initialize auto-launch
 */
async function initAutoLaunch() {
  try {
    var isEnabled = await autoLauncher.isEnabled();
    var shouldEnable = store.get('autoLaunch', true);
    
    if (shouldEnable && !isEnabled) {
      await autoLauncher.enable();
    } else if (!shouldEnable && isEnabled) {
      await autoLauncher.disable();
    }
  } catch (error) {
    logger.log('error', 'Main', 'Auto-launch init failed: ' + error.message);
  }
}

// App lifecycle events
app.whenReady().then(function() {
  logger.log('info', 'Main', 'App ready - version ' + app.getVersion());
  
  createWindow();
  createTray();
  initAutoLaunch();
  
  // Check for saved auth
  var savedToken = store.get('authToken');
  var savedUser = store.get('userData');
  if (savedToken && savedUser) {
    setTimeout(function() {
      handleAuthentication({ token: savedToken, user: savedUser });
    }, 2000);
  }
  
  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', function() {
  isQuitting = true;
  screenshotService.stop();
  socketHandler.disconnect();
  logger.log('info', 'Main', 'App quitting');
});

// Handle uncaught exceptions
process.on('uncaughtException', function(error) {
  logger.log('error', 'Main', 'Uncaught exception: ' + error.message);
});

process.on('unhandledRejection', function(reason) {
  logger.log('error', 'Main', 'Unhandled rejection: ' + reason);
});
