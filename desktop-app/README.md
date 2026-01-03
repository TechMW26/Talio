# Talio Desktop App

Electron desktop application for Talio HRMS with screen capture and activity monitoring.

## Features

- **Automatic Screen Capture**: Captures screen every 1 minute
- **Activity Sessions**: 30-minute sessions with 30 captures each
- **ImageKit Integration**: All screenshots uploaded to ImageKit CDN
- **Offline Support**: Queue captures when offline, upload when back online
- **Role-Based Restrictions**: Admin screens never captured, department heads can only capture their department
- **Auto-Start**: Launches automatically on system boot
- **No White Screens**: Proper loader and offline UI

## Requirements

- Node.js 18+
- npm 9+

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run against production server
npm start
```

## Building

```bash
# Build for all platforms
npm run build

# Build for macOS only
npm run build:mac

# Build for Windows only
npm run build:win

# Build for Linux only
npm run build:linux
```

## Architecture

```
src/
├── main.js              # Electron main process
├── preload.js           # Renderer preload script
├── screenshotService.js # Screen capture logic
├── sessionManager.js    # Activity session tracking
├── offlineQueue.js      # Offline queue management
├── imagekitUploader.js  # ImageKit upload handler
├── socketHandler.js     # Socket.IO for real-time events
├── permissionHandler.js # macOS permission management
└── logger.js            # Debug logging
```

## Capture Rules

| Role | Self-Capture | Capture Others |
|------|--------------|----------------|
| Admin | ❌ Never | ✅ Any user (manual) |
| Department Head | ✅ Automatic | ✅ Own department only |
| Employee | ✅ Automatic | ❌ Not allowed |

## Storage Structure (ImageKit)

```
activity/
├── {userId}/
│   ├── {YYYY-MM-DD}/
│   │   ├── {timestamp}.webp
│   │   └── ...
│   └── ...
└── ...
```

## Environment Variables

- `TALIO_APP_URL` - Override server URL (default: https://app.talio.in)

## Version History

- **4.0.0** - Complete rewrite with ImageKit, sessions, offline queue
- **3.1.0** - Previous version (deprecated)
