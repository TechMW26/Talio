## Talio Desktop v4.5.1 — Auto-Update Stability Fix

### Critical Bug Fixes

**1. Fixed: Force-persistent mode no longer blocks auto-update installation**
- `window.on('close')`, `window-all-closed`, and `before-quit` handlers now check `isUpdating` flag and allow clean quit during `quitAndInstall()`
- `scheduleWindowRecreation()` skips window recreation when an update is installing
- Eliminates the crash loop where the app fought between installing updates and resurrecting itself

**2. Fixed: `isUpdating` resets correctly on download errors**
- After a failed download, the flag is now reset so future update checks are no longer permanently disabled
- Multiple sequential failures no longer block all subsequent updates

**3. Fixed: 'Update Required' screen button now works**
- The blocking screen uses `data:` URLs which don't load `preload.js`, so `window.electronAPI` was undefined
- Button now communicates with main process via `console.log('TALIO_START_UPDATE')` intercepted by `webContents.on('console-message')`
- Also fixed CSS typo (`borrder-radius` to `border-radius`)

**4. Fixed: Min-version check no longer blocks app before update can install**
- `checkForceUpdate()` now attempts auto-update first before showing the blocking 'Update Required' screen
- The blocking screen only appears as a last resort when no update is available

**5. Fixed: Startup update check is now silent**
- Changed from `checkForUpdates(false)` to `checkForUpdates(true)` on startup
- No more 'Checking for updates...' dialog interrupting initial app load
- Increased startup delay from 3s to 5s to let the app load first

**6. New: Crash loop detection (Safe Mode)**
- Tracks startup timestamps via `electron-store`
- If 5+ starts within 60 seconds, enters Safe Mode: skips auto-update and min-version enforcement
- Shows a dialog informing the user about safe mode
- Resets automatically after 60+ seconds of stable operation

### Improvements
- Added detailed `[LIFECYCLE]` logging for the entire update lifecycle (checking, available, progress at 25% intervals, downloaded, quitAndInstall, error)
- `install-update` IPC handler now properly sets `isUpdating` flag
- Duplicate listener protection in `showUpdateRequiredScreen()`
- Renderer crash handler skips recovery during update installation

### Platforms
- macOS (ARM64 + Intel x64)
- Windows (x64 NSIS installer)
- Linux (x64 AppImage + deb)
