# Talio Desktop - Release Deployment Guide

## Overview

The Talio desktop app uses **GitHub Releases** for distribution. The app checks for updates via the `/api/desktop/min-version` API endpoint and directs users to the **App Info page** where they can download the latest installer (DMG/EXE) manually. Download links at `/download/[platform]` automatically redirect to the latest GitHub Release assets.

---

## Pre-Release Checklist

- [ ] All code changes committed and pushed to `main`
- [ ] `npm run build` (Next.js) passes without errors
- [ ] New version number decided (semver: `MAJOR.MINOR.PATCH`)

---

## Step 0: Check Latest Release Version

**IMPORTANT:** Before bumping the version, always check the latest release on GitHub to determine the next version number:

1. Go to **https://github.com/TechMW26/Talio/releases** (or use `gh release list --limit 1`)
2. Note the latest tag (e.g., `v5.2.0`)
3. Decide the next version using semver:
   - **Patch** (bug fixes): `5.2.0` → `5.2.1`
   - **Minor** (new features): `5.2.0` → `5.3.0`
   - **Major** (breaking changes): `5.2.0` → `6.0.0`

> **Never guess the version from file headers or package.json — always verify against the latest GitHub Release tag.** The source files may contain stale or conflicted version numbers.

---

## Step 1: Bump Version (4 files)

Update the version in **these four** locations:

| File | Constant / Field | Purpose |
|------|-----------------|--------|
| `desktop-app/package.json` | `"version"` | Electron app version; used by electron-builder for artifact naming |
| `desktop-app/src/main.js` | Header comment `v*.*.*` | Version reference in file header |
| `desktop-app/src/preload.js` | Header comment `v*.*.*` | Version reference in file header |
| `desktop-app/src/screenshotService.js` | Header comment `v*.*.*` | Version reference in file header |

> **Latest version detection is automatic.** Both `server.js` and `/api/desktop/min-version` fetch the latest release tag from the GitHub Releases API (cached for 5 minutes). No manual version bump needed on the server side.
>
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
| `Talio-{version}-x64.dmg` | macOS Intel installer |
| `Talio-{version}-arm64.dmg` | macOS Apple Silicon installer |
| `Talio-{version}-x64.zip` | macOS Intel archive (optional) |
| `Talio-{version}-arm64.zip` | macOS Apple Silicon archive (optional) |
| `Talio.Setup.{version}.exe` | Windows NSIS installer |

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

# 2. Store notarization credentials in the keychain (recommended)
xcrun notarytool store-credentials "talio-notary" \
  --apple-id "your-apple-id@email.com" \
  --team-id "XXXXXXXXXX" \
  --password "xxxx-xxxx-xxxx-xxxx"

# 3. Export the keychain profile for builds
export APPLE_KEYCHAIN_PROFILE="talio-notary"

# Or use the helper script:
cd desktop-app
npm run setup:notary-profile

# Alternative: set environment variables directly (add to ~/.zshrc or CI secrets)
export APPLE_ID="your-apple-id@email.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App-specific password
export APPLE_TEAM_ID="XXXXXXXXXX"                 # 10-character Team ID
```

#### How it works in the build

- `electron-builder` **automatically signs** the `.app` bundle using the Developer ID Application certificate found in your keychain (no extra env vars needed for signing itself).
- After signing, the `afterSign` hook in `package.json` runs `scripts/notarize.js`, which accepts any of these credential sources:
  1. `APPLE_KEYCHAIN_PROFILE`
  2. `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  3. `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`

  Then it:
  1. Submits the signed app to Apple for notarization
  2. Waits for Apple to verify it (usually 1–5 minutes)
  3. Staples the notarization ticket to the app (allows offline Gatekeeper verification)
- The DMG is also signed during packaging so Gatekeeper sees a signed installer container before the notarized app is opened.
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
- Windows signing options live under `build.win.signtoolOptions` in `package.json`
- The installer signs the `.exe` files by default, and Talio explicitly includes `.dll` files via `build.win.signExts: [".dll"]`
- Uses SHA-256 via `build.win.signtoolOptions.signingHashAlgorithms: ["sha256"]`
- Uses DigiCert timestamping via `build.win.signtoolOptions.timeStampServer` and `build.win.signtoolOptions.rfc3161TimeStampServer`
- The `publisherName: "MW FutureTech"` in `build.win.signtoolOptions` must match the name in the certificate

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

### GitHub CLI Authentication (one-time setup)

The `gh` CLI must be authenticated to create releases. Use a **Personal Access Token (PAT)**:

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Select scopes: `repo` (full control of private repos)
3. Copy the token

**Option A — Login with token (persistent):**
```bash
echo "ghp_YOUR_TOKEN_HERE" | gh auth login --with-token
```

**Option B — Set as environment variable (per-session or add to `~/.zshrc`):**
```bash
export GH_TOKEN="ghp_YOUR_TOKEN_HERE"
```

Verify auth:
```bash
gh auth status
```

### Using GitHub CLI

```bash
GH="/path/to/gh"   # or just "gh" if installed globally

cd desktop-app

$GH release create vX.Y.Z \
  --title "Talio Desktop vX.Y.Z" \
  --notes "Release notes here" \
  dist/Talio-X.Y.Z-x64.dmg \
  dist/Talio-X.Y.Z-arm64.dmg \
  dist/Talio-X.Y.Z-x64.zip \
  dist/Talio-X.Y.Z-arm64.zip \
  dist/Talio.Setup.X.Y.Z.exe
```

### Using Node.js Release Scripts (recommended — no `gh` CLI needed)

Two scripts in `desktop-app/scripts/` handle release creation and asset upload using the GitHub REST API directly via Node.js `https`. No extra dependencies required.

#### Prerequisites

Set your GitHub Personal Access Token as an environment variable:
```bash
export GH_TOKEN="ghp_YOUR_TOKEN_HERE"
```

#### Option A: Create release + upload assets in one step

```bash
cd desktop-app

# Create release with default notes and upload all 5 assets
node scripts/create-release.js X.Y.Z

# Create release with custom release notes
node scripts/create-release.js X.Y.Z "Bug fixes and performance improvements"
```

This will:
1. Create a new GitHub release tagged `vX.Y.Z` on `main`
2. Upload all 5 assets from `dist/` (arm64.dmg, x64.dmg, arm64.zip, x64.zip, Setup.exe)

#### Option B: Upload assets to an existing release

If you already created the release (via Web UI or the create script failed mid-upload), use this to upload/re-upload assets:

```bash
cd desktop-app

node scripts/upload-assets.js X.Y.Z
```

This will:
1. Look up the release by tag `vX.Y.Z`
2. Delete any existing assets with the same filenames (safe re-upload)
3. Upload all 5 assets from `dist/`

#### Script files

| Script | Purpose |
|--------|---------|
| `scripts/create-release.js` | Creates a GitHub release and uploads all assets |
| `scripts/upload-assets.js` | Uploads assets to an *existing* release (by tag) |

### Using GitHub Web UI

1. Go to https://github.com/TechMW26/Talio/releases/new
2. Tag: `vX.Y.Z` (create new tag)
3. Title: `Talio Desktop vX.Y.Z`
4. Upload the 5 files from `desktop-app/dist/` listed above
5. Write release notes
6. Publish release

> **Important:** The release must be marked as **"Latest"** (not Draft/Pre-release). The download links at `/download/[platform]` always redirect to the **latest** GitHub release.

---

## Step 6: Verify Release

```bash
# Check release is published (not draft) and marked as Latest
$GH release list --limit 3

# Verify all assets are uploaded
$GH release view vX.Y.Z --json assets --jq '.assets[].name'
```

Expected assets (5 files):
```
Talio-X.Y.Z-arm64.dmg
Talio-X.Y.Z-arm64.zip
Talio-X.Y.Z-x64.dmg
Talio-X.Y.Z-x64.zip
Talio.Setup.X.Y.Z.exe
```

---

## Step 7: Verify Download Links

The download routes at `/download/[platform]` fetch the **latest** GitHub release in real-time (no caching) and redirect to the matching asset. After publishing a release, the download links update **immediately**.

Verify each platform link redirects to the new version:

```bash
# Should redirect to the new arm64 DMG
curl -sI https://app.talio.in/download/mac-arm64 | grep -i location

# Should redirect to the new x64 DMG
curl -sI https://app.talio.in/download/mac-intel | grep -i location

# Should redirect to the new Windows EXE
curl -sI https://app.talio.in/download/windows | grep -i location
```

Each `Location:` header should contain the new version number (e.g., `Talio-X.Y.Z-arm64.dmg`).

> **Note:** The download route (`app/download/[platform]/route.js`) uses `cache: 'no-store'` to always hit the GitHub API for the latest release. This ensures new versions are reflected in download links the moment the GitHub release is published.

---

## How Update Checking Works

```
App starts → setupAutoUpdater() sets up periodic check (every 2 hours)
  → checkForUpdates() fetches /api/desktop/min-version
    → Compares latestVersion with app's package.json version
    → If newer version found:
      → Sends 'available' status to renderer via IPC
      → Shows native OS notification: "Update Available"
      → Notification click navigates to App Info page
  → User visits App Info page → auto-checks on mount
    → Shows "Download vX.Y.Z" button
    → Button opens /download/[platform] → redirects to GitHub Release asset
    → User installs the downloaded DMG/EXE manually
```

Additionally, when a desktop app connects via Socket.IO, `server.js` compares its version against the latest release fetched from the GitHub API and emits `trigger-update-check` if outdated. The version is refreshed automatically every 5 minutes.

---

## Troubleshooting

### Download links show old version
The download route fetches the **latest** GitHub release. Ensure the new release is marked as "Latest" (not Draft or Pre-release):
```bash
$GH release edit vX.Y.Z --latest
```

### App doesn't detect new version
- The latest version is fetched automatically from GitHub Releases (cached for 5 min). Ensure the release is marked as "Latest" — not Draft or Pre-release.
- If GitHub API rate-limits are hit, the server falls back to a hardcoded `FALLBACK_LATEST_DESKTOP` constant.
- The app checks every 2 hours; users can also check manually from the App Info page.

### Uploading assets to an existing release

**Using gh CLI:**
```bash
$GH release upload vX.Y.Z "filename" --clobber
```
The `--clobber` flag overwrites existing assets with the same name.

**Using Node.js script:**
```bash
cd desktop-app
node scripts/upload-assets.js X.Y.Z
```
The script automatically deletes and re-uploads matching assets.

### Code signing / notarization (macOS)
See the **Code Signing** section above for full setup instructions.

### Windows SmartScreen "not signed" warning
See the **Windows Code Signing** section above. You need an OV or EV code signing certificate.

---

## Quick Reference - Full Release Flow

```bash
# 0. Set GitHub token (one-time per session)
export GH_TOKEN="ghp_YOUR_TOKEN"

# 0.5 Check latest release version on GitHub
#     Visit: https://github.com/TechMW26/Talio/releases
#     OR: gh release list --limit 1
#     Then decide next version (e.g., v5.2.0 → v5.3.0)

# 1. Bump version in 4 files (package.json, main.js, preload.js, screenshotService.js)

# 2. Build & verify web
npm run build

# 3. Build desktop
cd desktop-app && npm run build && cd ..

# 4. Commit & push
git add -A && git commit -m "release: desktop app vX.Y.Z" && git push

# 5. Create release + upload assets (using Node.js scripts — no gh CLI needed)
cd desktop-app
node scripts/create-release.js X.Y.Z "Release notes here"

# OR if release already exists and you just need to upload/re-upload assets:
node scripts/upload-assets.js X.Y.Z

# 6. Verify
#    Visit: https://github.com/TechMW26/Talio/releases/tag/vX.Y.Z
#    OR: gh release view vX.Y.Z --json assets --jq '.assets[].name'
```
