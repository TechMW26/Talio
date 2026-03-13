# Talio Desktop — Release Deployment Guide

## Overview

The Talio desktop app uses **electron-updater** with **GitHub Releases** for auto-updates. Each release requires artifacts for macOS (DMG + ZIP) and Windows (NSIS installer), plus YAML manifests that electron-updater reads to detect and download updates.

---

## Pre-Release Checklist

- [ ] All code changes committed and pushed to `main`
- [ ] `npm run build` (Next.js) passes without errors
- [ ] New version number decided (semver: `MAJOR.MINOR.PATCH`)

---

## Step 1: Bump Version (3 files)

Update the version in **all three** locations:

| File | Constant / Field | Purpose |
|------|-----------------|---------|
| `desktop-app/package.json` | `"version"` | Electron app version; used by electron-builder for artifact naming and auto-updater comparison |
| `server.js` | `LATEST_DESKTOP_VERSION` | Triggers connected desktop clients to check for updates via Socket.IO |
| `app/api/desktop/min-version/route.js` | `LATEST_DESKTOP_VERSION` | REST endpoint the app polls for latest version info |

> **Note:** Only bump `MIN_DESKTOP_VERSION` in `min-version/route.js` when a release contains breaking changes that require all older apps to force-update.

---

## Step 2: Build Next.js

```bash
cd /path/to/Talio
npm run build
```

Verify it compiles without errors. This validates all web + API route changes.

---

## Step 3: Build Desktop App

From the `desktop-app/` directory:

### All platforms (macOS + Windows)
```bash
cd desktop-app
npm run build
```

### macOS only
```bash
npm run build:mac          # Both Intel + Apple Silicon
npm run build:mac-intel    # Intel (x64) only
npm run build:mac-arm      # Apple Silicon (arm64) only
```

### Windows only
```bash
npm run build:win
```

### Expected output in `desktop-app/dist/`

| File | Purpose |
|------|---------|
| `Talio-{version}-x64.dmg` | macOS Intel installer (manual install) |
| `Talio-{version}-arm64.dmg` | macOS Apple Silicon installer (manual install) |
| `Talio-{version}-x64.zip` | macOS Intel update package (**required for auto-update**) |
| `Talio-{version}-arm64.zip` | macOS Apple Silicon update package (**required for auto-update**) |
| `Talio.Setup.{version}.exe` | Windows NSIS installer |
| `latest-mac.yml` | macOS auto-update manifest (references ZIP files) |
| `latest.yml` | Windows auto-update manifest |

> **Critical:** macOS auto-update requires the `.zip` files. The `mac.target` in `package.json` must include both `"dmg"` and `"zip"`. Without ZIPs, users get "ZIP file not provided" error.

---

## Step 4: Commit & Push

```bash
git add -A
git commit -m "release: desktop app vX.Y.Z"
git push origin main
```

---

## Step 5: Create GitHub Release

### Using GitHub CLI

```bash
GH="/path/to/gh"   # or just "gh" if installed globally

cd desktop-app/dist

$GH release create vX.Y.Z \
  --title "Talio Desktop vX.Y.Z" \
  --notes "Release notes here" \
  "Talio-X.Y.Z-x64.dmg#Talio macOS (Intel)" \
  "Talio-X.Y.Z-arm64.dmg#Talio macOS (Apple Silicon)" \
  "Talio-X.Y.Z-x64.zip#Talio macOS Update (Intel)" \
  "Talio-X.Y.Z-arm64.zip#Talio macOS Update (Apple Silicon)" \
  "Talio.Setup.X.Y.Z.exe#Talio Windows Installer" \
  "latest-mac.yml#macOS Auto-Update Manifest" \
  "latest.yml#Windows Auto-Update Manifest"
```

### Using GitHub Web UI

1. Go to https://github.com/avirajsharma-ops/Talio/releases/new
2. Tag: `vX.Y.Z` (create new tag)
3. Title: `Talio Desktop vX.Y.Z`
4. Upload all 7 files from `desktop-app/dist/` listed above
5. Write release notes
6. Publish release (do **not** leave as draft — drafts are invisible to auto-updater)

---

## Step 6: Verify Release

```bash
# Check release is published (not draft) and marked as Latest
$GH release list --limit 3

# Verify all assets are uploaded
$GH release view vX.Y.Z --json assets --jq '.assets[].name'
```

Expected assets (7 files):
```
Talio-X.Y.Z-arm64.dmg
Talio-X.Y.Z-arm64.zip
Talio-X.Y.Z-x64.dmg
Talio-X.Y.Z-x64.zip
Talio.Setup.X.Y.Z.exe
latest-mac.yml
latest.yml
```

---

## How Auto-Update Works

```
App starts → setupAutoUpdater()
  → electron-updater reads latest-mac.yml (macOS) or latest.yml (Windows)
    from the latest GitHub Release
  → Compares version in YAML with app's package.json version
  → If newer version found:
    → Emits 'update-available' → UI shows "Software Update" card
    → User clicks "Update Now" → downloads ZIP (macOS) or EXE (Windows)
    → Emits 'update-downloaded' → UI shows "Install & Restart"
    → autoUpdater.quitAndInstall()
```

Additionally, when a desktop app connects via Socket.IO, `server.js` compares its version against `LATEST_DESKTOP_VERSION` and emits `trigger-update-check` if outdated.

---

## Troubleshooting

### "ZIP file not provided" error on macOS
The `latest-mac.yml` in the release doesn't reference a ZIP, or the ZIP wasn't uploaded. Ensure:
1. `mac.target` in `package.json` includes `"zip"` alongside `"dmg"`
2. Both `.zip` files are uploaded to the GitHub release
3. `latest-mac.yml` is uploaded and references the ZIP files

### Release shows as "Draft"
Draft releases are invisible to electron-updater. Publish it:
```bash
$GH release edit vX.Y.Z --draft=false --latest
```

### App sees wrong version
The app reads from the **latest** GitHub release. Ensure the new release is marked as "Latest":
```bash
$GH release edit vX.Y.Z --latest
```

### Uploading assets to an existing release
```bash
$GH release upload vX.Y.Z "filename" --clobber
```
The `--clobber` flag overwrites existing assets with the same name.

### Code signing / notarization (macOS)
Set environment variables before building:
```bash
export APPLE_ID="your-apple-id@email.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App-specific password
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run build:mac
```

---

## Quick Reference — Full Release Flow

```bash
# 1. Bump version in 3 files (package.json, server.js, min-version/route.js)

# 2. Build & verify web
npm run build

# 3. Build desktop
cd desktop-app && npm run build && cd ..

# 4. Commit & push
git add -A && git commit -m "release: desktop app vX.Y.Z" && git push

# 5. Create release
cd desktop-app/dist
gh release create vX.Y.Z --title "Talio Desktop vX.Y.Z" --notes "..." \
  Talio-X.Y.Z-x64.dmg Talio-X.Y.Z-arm64.dmg \
  Talio-X.Y.Z-x64.zip Talio-X.Y.Z-arm64.zip \
  Talio.Setup.X.Y.Z.exe latest-mac.yml latest.yml

# 6. Verify
gh release view vX.Y.Z --json assets --jq '.assets[].name'
```
