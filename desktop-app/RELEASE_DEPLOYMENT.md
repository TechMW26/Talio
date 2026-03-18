# Talio Desktop - Release Deployment Guide

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

### Signed builds (requires certificates — see Code Signing section below)
```bash
npm run build:signed
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

## Code Signing

Both macOS and Windows require code signing for the OS to recognise the app as safe. **Without signing, users see security warnings (macOS Gatekeeper / Windows SmartScreen) and may not be able to install or update the app.**

### macOS Code Signing + Notarization

macOS requires **two steps**: code signing (with an Apple Developer certificate) and notarization (Apple verifies the app remotely and staples a ticket).

#### Prerequisites

1. **Apple Developer Program membership** ($99/year) — [developer.apple.com](https://developer.apple.com/programs/)
2. **Developer ID Application certificate** — created in Xcode or Apple Developer portal
   - Open Xcode → Settings → Accounts → Manage Certificates → "+" → **Developer ID Application**
   - OR: [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates) → Create → Developer ID Application
3. **App-specific password** for notarization (NOT your Apple ID password)
   - Go to [appleid.apple.com/account/manage](https://appleid.apple.com/account/manage)
   - Under "Sign-In and Security" → "App-Specific Passwords" → "Generate Password"
4. **Apple Team ID** — visible at [developer.apple.com/account](https://developer.apple.com/account) under "Membership details"

#### Setup (one-time)

```bash
# 1. Ensure your Developer ID Application certificate is in the macOS Keychain
#    If you created it in Xcode, it's already there.
#    If you downloaded a .p12 from the portal, double-click to import it.

# 2. Set environment variables (add to ~/.zshrc or CI secrets)
export APPLE_ID="your-apple-id@email.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App-specific password
export APPLE_TEAM_ID="XXXXXXXXXX"                 # 10-character Team ID
```

#### How it works in the build

- `electron-builder` **automatically signs** the `.app` bundle using the Developer ID Application certificate found in your keychain (no extra env vars needed for signing itself).
- After signing, the `afterSign` hook in `package.json` runs `scripts/notarize.js`, which:
  1. Submits the signed app to Apple for notarization
  2. Waits for Apple to verify it (usually 1–5 minutes)
  3. Staples the notarization ticket to the app (allows offline Gatekeeper verification)
- **Entitlements** are defined in `build/entitlements.mac.plist` — they declare camera, microphone, screen recording, network, and file access capabilities.

#### Build command

```bash
# Ensure env vars are set, then build normally:
cd desktop-app
npm run build:mac
```

electron-builder will sign automatically if a valid certificate is in the keychain. If no certificate is found, it builds unsigned (with a console warning).

#### Verify signing

```bash
# Check if the .app is signed
codesign --verify --deep --strict dist/mac-arm64/Talio.app

# Check notarization status
spctl -a -vv dist/mac-arm64/Talio.app
# Should show: "source=Notarized Developer ID"

# Check the DMG
spctl -a -vv --type install dist/Talio-4.9.0-arm64.dmg
```

---

### Windows Code Signing

Windows SmartScreen blocks unsigned installers with "Windows protected your PC" warnings. Signing the installer removes this warning and shows "Verified publisher: MW FutureTech".

#### Prerequisites

1. **Code Signing Certificate** from a Certificate Authority (CA):
   - **OV (Organization Validation)** — takes ~3-5 days, removes SmartScreen warning after reputation builds
   - **EV (Extended Validation)** — takes ~1-2 weeks, **immediately** trusted by SmartScreen (recommended)
   - Recommended CAs: [DigiCert](https://www.digicert.com/signing/code-signing-certificates), [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing), [GlobalSign](https://www.globalsign.com/en/code-signing-certificate)
2. **Export the certificate as `.pfx`** (PKCS#12 format) with a password

#### Setup (one-time)

```bash
# Set environment variables (add to ~/.zshrc or CI secrets)
export CSC_LINK="/absolute/path/to/certificate.pfx"    # Path to .pfx file
export CSC_KEY_PASSWORD="your-pfx-password"             # Password for the .pfx
```

Alternatively, `CSC_LINK` can be a base64-encoded string of the .pfx file (useful for CI/CD):
```bash
export CSC_LINK=$(base64 -i certificate.pfx)
export CSC_KEY_PASSWORD="your-pfx-password"
```

#### How it works in the build

- `electron-builder` detects `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables
- It signs the `.exe` installer and all `.dll` files inside the app (`signDlls: true` in `package.json`)
- Uses SHA-256 hash algorithm (`signingHashAlgorithms: ["sha256"]` in `package.json`)
- The `publisherName: "MW FutureTech"` in `package.json` must match the name in the certificate

#### Build command

```bash
# With env vars set:
cd desktop-app
npm run build:win

# Or explicitly:
CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=password npm run build:win
```

If `CSC_LINK` is not set, the build proceeds without signing (with a console warning).

#### Verify signing

```powershell
# On Windows — right-click the .exe → Properties → Digital Signatures tab
# Should show "MW FutureTech" with "sha256" algorithm

# Or via PowerShell:
Get-AuthenticodeSignature "Talio.Setup.4.9.0.exe"
# Status should be "Valid"
```

#### SmartScreen reputation (OV certificates)

With an **OV certificate**, SmartScreen learns reputation over time. The first few hundred downloads may still show a warning. To accelerate trust:
1. Submit the signed installer to [Microsoft's malware analysis](https://www.microsoft.com/en-us/wdsi/filesubmission)
2. Distribute via your website with HTTPS
3. After ~1-2 weeks with enough downloads, the warning disappears

With an **EV certificate**, SmartScreen trusts the app **immediately** — no reputation period needed.

---

### Building Without Certificates (Development / Testing)

If you don't have certificates yet, builds will proceed unsigned. Users will see:
- **macOS:** "Talio can't be opened because Apple cannot check it for malicious software" → user must right-click → Open
- **Windows:** "Windows protected your PC" SmartScreen warning → user must click "More info" → "Run anyway"

To suppress certificate warnings during dev builds:
```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false   # macOS: skip certificate search
cd desktop-app && npm run build
```

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
6. Publish release (do **not** leave as draft - drafts are invisible to auto-updater)

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
See the **Code Signing** section above for full setup instructions.

### Windows SmartScreen "not signed" warning
See the **Windows Code Signing** section above. You need an OV or EV code signing certificate.

---

## Quick Reference - Full Release Flow

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