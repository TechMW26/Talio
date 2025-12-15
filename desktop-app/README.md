# Talio Desktop Application

Cross-platform desktop application for Talio with productivity monitoring.

## Features

- 🌐 **Webview Wrapper** - Wraps app.talio.in in a native desktop app
- 📸 **Automatic Screenshots** - Takes screenshots every minute when clocked in
- 🔔 **Notifications** - Native desktop notifications
- 🎥 **Screen Sharing** - Full screen sharing support for meetings
- 📍 **Geolocation** - Location tracking for attendance
- 🔐 **Google Login** - Syncs browser data for seamless Google authentication
- 🖥️ **Background Service** - Runs in system tray, persists through restarts
- ⚡ **Auto-Start** - Launches automatically on system boot

## Platforms Supported

- **macOS**: Intel (x64) and Apple Silicon (arm64)
- **Windows**: 32-bit (ia32) and 64-bit (x64)

## Prerequisites

- Node.js 18+
- npm or yarn
- ImageMagick (for icon generation)

### macOS
```bash
brew install imagemagick
```

### Windows
```bash
choco install imagemagick
```

## Installation

```bash
cd desktop-app
npm install
```

## Development

```bash
npm run dev
```

## Building

### Generate Icons First

```bash
chmod +x generate-icons.sh
./generate-icons.sh
```

### Build All Platforms

```bash
npm run build
```

### Build Specific Platforms

```bash
# macOS Intel DMG
npm run build:mac-intel

# macOS Apple Silicon DMG  
npm run build:mac-arm

# Windows (32-bit + 64-bit)
npm run build:win
```

## Build Output

After building, the installers will be in the `dist/` folder:

- `Talio-1.0.0-x64.dmg` - macOS Intel
- `Talio-1.0.0-arm64.dmg` - macOS Apple Silicon
- `Talio Setup 1.0.0.exe` - Windows (both 32-bit and 64-bit)

## How It Works

### Screenshot Service

1. The app checks clock-in status every 30 seconds via `/api/activity/clock-status`
2. When the user is clocked in, screenshots are taken every 60 seconds
3. Screenshots are compressed to WebP format for optimal file size
4. Uploaded to `/api/activity/screenshot` endpoint
5. Saved to `public/activity/{userId}/{date}/{timestamp}.webp`

### Permissions

On first launch, the app requests:

- **Camera** - For video calls
- **Microphone** - For audio calls
- **Screen Recording** - For screenshots and screen sharing
- **Notifications** - For alerts
- **Location** - For attendance geofencing

### Background Operation

- Closing the window minimizes to system tray
- App continues running in background
- Screenshots continue when user is clocked in
- Auto-starts on system boot

## Troubleshooting

### macOS: Screen Recording Permission

If screenshots aren't working:

1. Open **System Preferences** → **Privacy & Security** → **Screen Recording**
2. Enable **Talio**
3. Restart the app

### Windows: Antivirus Blocking

Some antivirus software may block the screenshot functionality:

1. Add Talio to your antivirus whitelist
2. Ensure the app has required permissions

### Google Login Not Working

If Google login fails:

1. Ensure cookies are enabled in the app
2. Try clearing the app data and logging in again
3. Check if third-party cookies are being blocked

## Code Signing

For production releases, you'll need:

### macOS
- Apple Developer certificate
- Run `electron-builder --mac --sign`

### Windows
- EV Code Signing certificate
- Configure in `package.json` under `build.win.certificateFile`

## License

MIT
