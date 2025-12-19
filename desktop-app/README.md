# Talio Desktop Application v2.0.0

A comprehensive Electron-based desktop application for the Talio HRMS platform that provides productivity monitoring and screen capture capabilities.

## Features

### ✅ Core Functionality
- **Automatic Screen Capture**: Captures full desktop every 1 minute when user is clocked in
- **30-Minute Activity Sessions**: Groups captures into 30-minute sessions (30 captures per session)
- **Multi-Monitor Support**: Captures from all connected displays
- **Offline Queue**: Stores captures locally when offline and uploads when connection is restored

### ✅ Role-Based Restrictions (Critical)
- **Admin Role**: Admin screens are NEVER captured - enforced at all levels
- **Department Head**: Can capture screens of users in their department only
- **Regular Employees**: Automatic capture when clocked in

### ✅ User Experience
- **Loading Screen**: Shows branded loading screen on startup (no white screen)
- **Offline Mode**: Displays friendly offline screen when internet is unavailable
- **Auto-Retry**: Automatically reconnects when network is restored
- **System Tray**: Runs in background with tray icon showing capture status
- **Auto-Start**: Launches automatically on system startup

### ✅ Permissions (macOS)
- Automatic permission requests on login
- Screen Recording permission (required)
- Camera & Microphone for meetings
- System Settings deep links for easy permission management

## Directory Structure

```
desktop-app/
├── src/
│   ├── main.js              # Main process entry point
│   ├── preload.js           # Preload script for renderer
│   ├── screenshotService.js # Screenshot capture & upload
│   ├── sessionManager.js    # Activity session management
│   ├── offlineManager.js    # Offline capture queue
│   └── permissionHandler.js # OS permission management
├── build/
│   ├── icon.icns           # macOS icon
│   ├── icon.ico            # Windows icon
│   ├── icon.png            # Linux icon
│   └── tray-icon.png       # System tray icon
├── package.json
└── README.md
```

## Installation

```bash
cd desktop-app
npm install
```

## Development

```bash
# Start in development mode
npm run dev

# Start normally
npm start
```

## Building

### All Platforms
```bash
npm run build
```

### macOS Only
```bash
# Intel Mac
npm run build:mac-intel

# Apple Silicon (M1/M2/M3)
npm run build:mac-arm

# Both architectures
npm run build:mac
```

### Windows Only
```bash
npm run build:win
```

### Linux Only
```bash
npm run build:linux
```

## Output

Built applications are placed in `dist/` directory:
- **macOS**: `Talio-x.x.x-arm64.dmg` / `Talio-x.x.x-x64.dmg`
- **Windows**: `Talio Setup x.x.x.exe`
- **Linux**: `Talio-x.x.x.AppImage` / `talio_x.x.x_amd64.deb`

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/api/activity/screenshot` | Upload captured screenshots |
| `/api/activity/clock-status` | Check if user is clocked in |
| `/api/auth/me` | Get user info and role |
| `/api/activity/manual-capture` | Request manual capture (Admin/Dept Head) |

## Storage Structure

Screenshots are uploaded to the server and stored in:
```
public/activity/{userId}/{YYYY-MM-DD}/{timestamp}.webp
```

## Session Logic

- **Session Duration**: 30 minutes
- **Captures Per Session**: 30 (1 per minute)
- **Session Metadata**:
  - Unique session ID
  - Start/end time
  - Capture count
  - Completion status

## Role-Based Capture Rules

### ❌ Admin (Self)
- Admin's own screen is **NEVER** captured
- Enforced at:
  - Electron desktop app level
  - Backend API level
  - Frontend UI level

### ✅ Admin (Others)
- Can manually capture any user's screen (except other admins)
- Has access to all users across departments

### ✅ Department Head
- Can capture screens of users in their department only
- Cannot capture admin screens
- Cannot capture users from other departments

### ✅ Regular Employee
- Automatic capture when clocked in
- No control over capture settings
- Cannot initiate manual captures

## Desktop App Exposed APIs

The following APIs are exposed to the renderer via `window.talioDesktop`:

```javascript
// Check if running in desktop app
window.talioDesktop.isDesktopApp // true

// Platform detection
await window.talioDesktop.getPlatform() // 'darwin', 'win32', 'linux'

// Auth token management
await window.talioDesktop.getAuthToken()
await window.talioDesktop.setAuthToken(token)

// User management
await window.talioDesktop.getUserId()
await window.talioDesktop.setUserId(userId)
await window.talioDesktop.getUserRole()
await window.talioDesktop.setUserRole(role)

// Screenshot controls
await window.talioDesktop.getScreenshotStatus()
await window.talioDesktop.forceScreenshot()
await window.talioDesktop.restartScreenshotService()

// Session info
await window.talioDesktop.getSessionInfo()

// Capture restrictions
await window.talioDesktop.getCaptureRestrictions()

// Permissions
await window.talioDesktop.requestAllPermissions()
await window.talioDesktop.getPermissionStatus()
await window.talioDesktop.requestScreenCapturePermission()

// Events
window.talioDesktop.onCaptureComplete((data) => {
  console.log('Capture complete:', data)
})
```

## Troubleshooting

### White Screen on Startup
- This issue has been fixed with the loading screen implementation
- If still occurring, check network connectivity

### Screenshots Not Being Captured
1. Ensure Screen Recording permission is granted (macOS)
2. Check if user is clocked in
3. Verify user role is not admin
4. Check desktop app logs: View → Developer Tools

### Permission Issues (macOS)
1. Open System Settings → Privacy & Security → Screen Recording
2. Enable Talio
3. Restart the application

### Offline Captures Not Uploading
1. Check network connectivity
2. View offline queue status in developer tools
3. Queue processes automatically every 30 seconds

## Changelog

### v2.0.0
- Complete rewrite of screen capture system
- Added 30-minute session management
- Implemented role-based capture restrictions
- Added loading screen (fixes white screen issue)
- Added offline screen with auto-retry
- Implemented offline capture queue
- Added multi-monitor support
- Added capture status indicator in UI
- Enhanced permission handling for macOS
- Added manual capture support for Admin/Dept Head

### v1.0.0
- Initial release
- Basic screen capture functionality
- System tray support
- Auto-start on boot

## License

Copyright © 2024 Talio. All rights reserved.
