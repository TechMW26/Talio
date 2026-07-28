# Latest Release API Integration Guide

This document explains how the Talio production server detects the latest GitHub release, downloads the release asset, stores it on the server, and exposes stable URLs that another website can use.

Production base URL:

```text
https://app.talio.in
```

## Quick Summary

Use this endpoint from another website to get the latest release metadata:

```http
GET https://app.talio.in/api/latest-release
```

Use this stable URL to download the current latest release file:

```http
GET https://app.talio.in/download/latest
```

Configure GitHub to send release webhooks here:

```http
POST https://app.talio.in/webhooks/github-release
```

The download URL never changes. When a new GitHub release is published, the server updates the file behind `/download/latest`.

## System File Map

These files implement the full flow:

| File | Purpose |
| --- | --- |
| `lib/latestReleaseManager.js` | Core release logic: fetch GitHub release, select asset, download file, write metadata, update latest pointer, verify webhook signatures. |
| `lib/latestReleaseCron.js` | Fallback cron checker. Runs periodically in the Node server and syncs the latest GitHub release if the webhook was missed. |
| `app/api/latest-release/route.js` | Public metadata API route. Returns JSON describing the currently downloaded latest release. |
| `app/download/latest/route.js` | Public stable download route. Sends the latest file with download headers. In production, it uses Nginx `X-Accel-Redirect` for efficient file serving. |
| `app/webhooks/github-release/route.js` | GitHub webhook route. Verifies GitHub signature and processes `release` events with action `published`. |
| `server.js` | Starts the fallback release cron when the custom Node/Next server boots. |
| `middleware.js` | Allows unauthenticated public access to `/api/latest-release`. |
| `docker-compose.yml` | Mounts `./releases` into the app container for writes and into the Nginx container read-only for serving. |
| `Dockerfile` | Creates the runtime release storage path and gives the app user write access. |
| `nginx/conf.d/default.conf` | Routes `/download/latest`, `/api/latest-release`, and `/webhooks/github-release`; serves protected release files internally. |
| `.env` | Stores GitHub token, webhook secret, repo details, and storage path. Never commit this file. |
| `.env.example` | Documents the required release environment variables. |
| `.gitignore` | Ignores `releases/` so downloaded installers are not committed. |

## Server Storage

Release files are stored on the production server here:

```text
/var/www/talio/releases
```

The current live file is exposed through this stable pointer:

```text
/var/www/talio/releases/latest
```

The latest metadata file is stored here:

```text
/var/www/talio/releases/latest.json
```

Example current storage layout:

```text
/var/www/talio/releases/
  latest -> v6.0.2/Talio-6.0.2-arm64.dmg
  latest.json
  v6.0.2/
    Talio-6.0.2-arm64.dmg
```

Previous release folders are kept unless manually removed.

## Environment Variables

Production `.env` must contain these values:

```env
GITHUB_OWNER=TechMW26
GITHUB_REPO=Talio
GITHUB_TOKEN=your-private-github-token
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret
RELEASE_STORAGE_PATH=/var/www/talio/releases
PUBLIC_BASE_URL=https://app.talio.in
```

Optional asset selection variables:

```env
RELEASE_ASSET_NAME=Talio.Setup.6.0.2.exe
RELEASE_ASSET_PATTERN=Talio\.Setup\..*\.exe$
LATEST_RELEASE_CRON=*/15 * * * *
LATEST_RELEASE_CRON_ENABLED=true
```

Asset selection priority:

1. `RELEASE_ASSET_NAME` exact match.
2. `RELEASE_ASSET_PATTERN` regex match.
3. First installer-like asset: `.dmg`, `.exe`, `.msi`, `.pkg`, `.zip`, `.appimage`, `.deb`, `.rpm`.
4. First non-metadata asset.

Current production behavior serves the first installer-like asset GitHub returns. At the time of deployment, that is:

```text
Talio-6.0.2-arm64.dmg
```

If the other website should always download the Windows installer, set:

```env
RELEASE_ASSET_PATTERN=Talio\.Setup\..*\.exe$
```

Then restart the app stack.

## API 1: Latest Release Metadata

### Request

```http
GET /api/latest-release
```

Full URL:

```text
https://app.talio.in/api/latest-release
```

Authentication:

```text
None. This endpoint is public.
```

### Curl

```bash
curl -sS https://app.talio.in/api/latest-release
```

### Success Response

```json
{
  "version": "v6.0.2",
  "download_url": "https://app.talio.in/download/latest",
  "file_name": "Talio-6.0.2-arm64.dmg",
  "published_at": "2026-04-06T06:09:02Z",
  "release_name": "Talio Desktop v6.0.2",
  "asset_size": 109762349,
  "content_type": "application/octet-stream",
  "downloaded_at": "2026-05-08T08:17:49.050Z",
  "release_url": "https://github.com/TechMW26/Talio/releases/tag/v6.0.2"
}
```

### Error Response

If no release file has been downloaded yet:

```json
{
  "error": "Latest release is not available yet",
  "download_url": null
}
```

HTTP status:

```text
404
```

## API 2: Stable Latest Download

### Request

```http
GET /download/latest
```

Full URL:

```text
https://app.talio.in/download/latest
```

Authentication:

```text
None. This endpoint is public.
```

### Curl Header Check

Use `-I` to check headers without downloading the full installer:

```bash
curl -I https://app.talio.in/download/latest
```

Expected headers include:

```http
HTTP/2 200
content-type: application/octet-stream
content-length: 109762349
content-disposition: attachment; filename="Talio-6.0.2-arm64.dmg"
cache-control: no-store
accept-ranges: bytes
```

### Browser Behavior

When a browser opens this URL, the file downloads automatically using the current file name.

The URL stays stable forever:

```text
https://app.talio.in/download/latest
```

Only the file behind the URL changes when a new GitHub release is published.

## API 3: GitHub Release Webhook

### Request

```http
POST /webhooks/github-release
```

Full URL:

```text
https://app.talio.in/webhooks/github-release
```

This endpoint is intended for GitHub, not normal frontend traffic.

### Required Headers

GitHub sends these automatically:

```http
X-GitHub-Event: release
X-GitHub-Delivery: unique-delivery-id
X-Hub-Signature-256: sha256=<hmac-signature>
Content-Type: application/json
```

### Required Event

The server only processes this GitHub event:

```text
release
```

The server only processes this action:

```text
published
```

Other events or release actions are ignored safely.

### Webhook Payload Shape

GitHub sends the full release payload. The server uses the release ID to fetch the latest canonical release data from GitHub.

Minimal shape:

```json
{
  "action": "published",
  "release": {
    "id": 305543543,
    "tag_name": "v6.0.2"
  }
}
```

### Success Response

```json
{
  "ok": true,
  "updated": true,
  "version": "v6.0.2",
  "file_name": "Talio-6.0.2-arm64.dmg"
}
```

If the same release is already downloaded:

```json
{
  "ok": true,
  "updated": false,
  "version": "v6.0.2",
  "file_name": "Talio-6.0.2-arm64.dmg"
}
```

### Signature Failure

If the signature is invalid:

```json
{
  "error": "Invalid signature"
}
```

HTTP status:

```text
401
```

## GitHub Webhook Configuration

In the GitHub repository:

1. Open `Settings`.
2. Open `Webhooks`.
3. Click `Add webhook`.
4. Set `Payload URL`:

```text
https://app.talio.in/webhooks/github-release
```

5. Set `Content type`:

```text
application/json
```

6. Set `Secret` to the value from production `.env`:

```text
GITHUB_WEBHOOK_SECRET
```

7. Enable SSL verification.
8. Select `Let me select individual events`.
9. Select `Releases`.
10. Save the webhook.

When a new GitHub release is published, GitHub calls the webhook immediately.

## Fallback Cron Behavior

Webhook is immediate, but cron is the backup.

Default schedule:

```text
*/15 * * * *
```

That means every 15 minutes the app checks GitHub's latest release. If the latest release file is missing or changed, it downloads it and updates the stable `/download/latest` pointer.

The cron starts from `server.js` through `lib/latestReleaseCron.js`.

## End-to-End Data Flow

New release path:

```text
GitHub release published
  -> GitHub sends POST /webhooks/github-release
  -> server verifies X-Hub-Signature-256 with GITHUB_WEBHOOK_SECRET
  -> server confirms event is release and action is published
  -> server fetches release details from GitHub API using GITHUB_TOKEN
  -> server selects one release asset
  -> server downloads asset into /var/www/talio/releases/<version>/
  -> server updates /var/www/talio/releases/latest
  -> server writes /var/www/talio/releases/latest.json
  -> another website calls /api/latest-release
  -> another website redirects user to /download/latest
```

Fallback path:

```text
Cron runs every 15 minutes
  -> server calls GitHub latest release API
  -> if latest release is new, it downloads the asset
  -> /download/latest starts serving the new file
```

## Other Website Integration

### Simple HTML Button

```html
<button id="downloadBtn">Download Latest</button>

<script>
document.getElementById("downloadBtn").addEventListener("click", async () => {
  const response = await fetch("https://app.talio.in/api/latest-release");
  const data = await response.json();

  if (!response.ok || !data.download_url) {
    alert("Latest release is not available yet.");
    return;
  }

  window.location.href = data.download_url;
});
</script>
```

### Download Button With Version Text

```html
<button id="downloadBtn">Checking latest version...</button>

<script>
const button = document.getElementById("downloadBtn");
let latestDownloadUrl = null;

async function loadLatestRelease() {
  try {
    const response = await fetch("https://app.talio.in/api/latest-release");
    const data = await response.json();

    if (!response.ok || !data.download_url) {
      button.textContent = "Download unavailable";
      button.disabled = true;
      return;
    }

    latestDownloadUrl = data.download_url;
    button.textContent = `Download Talio ${data.version}`;
    button.disabled = false;
  } catch {
    button.textContent = "Download unavailable";
    button.disabled = true;
  }
}

button.addEventListener("click", () => {
  if (latestDownloadUrl) {
    window.location.href = latestDownloadUrl;
  }
});

loadLatestRelease();
</script>
```

### React Example

```jsx
import { useEffect, useState } from 'react';

export default function LatestTalioDownloadButton() {
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadRelease() {
      try {
        const response = await fetch('https://app.talio.in/api/latest-release');
        const data = await response.json();

        if (!response.ok || !data.download_url) {
          throw new Error(data.error || 'Latest release is not available yet');
        }

        setRelease(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadRelease();
  }, []);

  if (loading) return <button disabled>Checking latest version...</button>;
  if (error) return <button disabled>Download unavailable</button>;

  return (
    <button onClick={() => { window.location.href = release.download_url; }}>
      Download Talio {release.version}
    </button>
  );
}
```

## Backend Integration Example

If another backend wants to fetch metadata first:

```js
async function getLatestTalioRelease() {
  const response = await fetch('https://app.talio.in/api/latest-release', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Talio release API returned ${response.status}`);
  }

  return response.json();
}

async function handleDownloadRedirect(req, res) {
  const release = await getLatestTalioRelease();
  res.redirect(302, release.download_url);
}
```

## Test Commands

### Metadata API

```bash
curl -sS https://app.talio.in/api/latest-release
```

### Download Headers

```bash
curl -I https://app.talio.in/download/latest
```

### Download File

```bash
curl -L -o Talio-latest.dmg https://app.talio.in/download/latest
```

### Webhook Reachability

```bash
curl -i https://app.talio.in/webhooks/github-release
```

### Invalid Signature Test

This should return `401`:

```bash
curl -i -X POST https://app.talio.in/webhooks/github-release \
  -H 'X-GitHub-Event: release' \
  -H 'X-Hub-Signature-256: sha256=bad' \
  -H 'Content-Type: application/json' \
  --data '{"action":"published"}'
```

### Signed Webhook Smoke Test

Use this only on a secure machine that has the webhook secret available. Do not paste real secrets into shared logs.

```bash
export WEBHOOK_SECRET='your-webhook-secret'

node <<'JS'
const crypto = require('crypto');
const payload = JSON.stringify({ action: 'published', release: { id: 305543543 } });
const signature = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(payload)
  .digest('hex');

fetch('https://app.talio.in/webhooks/github-release', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-GitHub-Event': 'release',
    'X-GitHub-Delivery': 'local-smoke-test',
    'X-Hub-Signature-256': `sha256=${signature}`,
  },
  body: payload,
})
  .then(async (response) => {
    console.log(response.status);
    console.log(await response.text());
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
JS
```

Expected response when the latest release is already downloaded:

```json
{
  "ok": true,
  "updated": false,
  "version": "v6.0.2",
  "file_name": "Talio-6.0.2-arm64.dmg"
}
```

## Security Notes

Do not expose these values in frontend code:

```text
GITHUB_TOKEN
GH_TOKEN
GITHUB_WEBHOOK_SECRET
```

Only these public URLs should be used by another website:

```text
https://app.talio.in/api/latest-release
https://app.talio.in/download/latest
```

The webhook endpoint is public on the internet, but it rejects requests unless the `X-Hub-Signature-256` header matches `GITHUB_WEBHOOK_SECRET`.

The download endpoint does not accept a user-provided file path. It only serves the internally tracked latest release file from `/var/www/talio/releases`.

## Operational Commands

Check release metadata on the server:

```bash
ssh root@89.116.134.129 'cd /var/www/talio && sed -n "1,120p" releases/latest.json'
```

Check release files:

```bash
ssh root@89.116.134.129 'cd /var/www/talio && ls -lah releases releases/*'
```

Check release sync logs:

```bash
ssh root@89.116.134.129 'docker logs --since 30m talio-app 2>&1 | grep -E "ReleaseCron|ReleaseSync|GitHubReleaseWebhook"'
```

Restart the production stack after changing release environment variables:

```bash
ssh root@89.116.134.129 'cd /var/www/talio && docker compose down && docker compose up -d --wait talio-app nginx'
```

## Troubleshooting

### Metadata API returns 404

Cause:

```text
No release has been downloaded yet.
```

Fix:

```text
Check GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, and release assets. Then trigger the webhook or wait for cron.
```

### Webhook returns 401

Cause:

```text
Invalid or missing X-Hub-Signature-256.
```

Fix:

```text
Make sure the GitHub webhook secret exactly matches GITHUB_WEBHOOK_SECRET in production .env.
```

### GitHub API returns 401 Bad credentials

Cause:

```text
The GitHub token is invalid, revoked, expired, or copied incorrectly.
```

Fix:

```text
Create a new token with access to the private repository and update GITHUB_TOKEN in /var/www/talio/.env.
```

### GitHub API returns 404 Not Found

Possible causes:

```text
The token cannot access the repository.
The owner or repo name is wrong.
The repo is private and the token lacks permission.
```

Fix:

```text
Confirm GITHUB_OWNER=TechMW26 and GITHUB_REPO=Talio.
Confirm the token can access the private repository releases.
```

### Download URL returns 404

Cause:

```text
/var/www/talio/releases/latest does not exist or points to a missing file.
```

Fix:

```text
Check releases/latest.json and run the release sync through webhook or cron.
```

### Wrong asset is downloaded

Cause:

```text
The release contains multiple assets and the default selector picked a different installer.
```

Fix:

```text
Set RELEASE_ASSET_NAME or RELEASE_ASSET_PATTERN in .env and restart the app stack.
```
