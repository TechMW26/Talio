## Talio Desktop v5.0.0 - Major Update: macOS 26 Compatibility

### Breaking Changes
- **Electron upgraded from 28 to 35** for macOS 26 (Sequoia 2) compatibility
- **electron-builder upgraded from 24 to 26** for compatibility with Electron 35

### Bug Fixes

**1. Fixed: App crashing on macOS 26 with SIGSEGV (pointer authentication failure)**
- Electron 28's Chromium V8 engine was incompatible with macOS 26's ARM64 PAC implementation
- Upgraded to Electron 35.x which fully supports macOS 26

**2. Fixed: desktopCapturer API migration (Electron 29+ breaking change)**
- `desktopCapturer` was removed from the main process in Electron 29
- Screen capture now routes through the preload/renderer via IPC bridge
- New `getDesktopSourcesForCapture()` preload method returns base64 JPEG data for screenshot service
- `setDisplayMediaRequestHandler` and `request-screen-share` updated to use IPC

**3. Windows code signing verification bypass preserved**
- Runtime `verifyUpdateCodeSignature` override still in place for Windows auto-updates
- Note: Users on v4.5.1 or earlier cannot auto-update (must manually download v5.0.0)

### Internal Changes
- Removed deprecated `mediaStreamShareSecurityOrigin` webPreference
- Screenshot service now receives `getDesktopSources` function via dependency injection

---

## Talio Desktop v4.9.2 - Windows Update Fix

### Bug Fixes

**1. Fixed: Windows auto-update failing with "not digitally signed" error**
- Added runtime override to skip code signature verification on Windows during auto-update
- Previously, unsigned Windows builds would fail the Authenticode signature check during update download/install
- The `verifyUpdateCodeSignature` setting in electron-builder config only applies to new installations; this fix applies to all existing installations via runtime override in `setupAutoUpdater()`
- macOS was unaffected as it uses a different verification mechanism

---

## Talio Desktop v4.5.1 - Auto-Update Stability Fix

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
