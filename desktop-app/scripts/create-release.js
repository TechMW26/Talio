#!/usr/bin/env node
/**
 * Create a GitHub Release and upload all desktop app assets.
 *
 * Usage:
 *   node scripts/create-release.js <version> [release-notes]
 *
 * Examples:
 *   node scripts/create-release.js 5.3.0
 *   node scripts/create-release.js 5.3.0 "Bug fixes and performance improvements"
 *
 * Environment:
 *   GH_TOKEN  — GitHub Personal Access Token (required)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GH_TOKEN environment variable is required.');
  console.error('  export GH_TOKEN="ghp_YOUR_TOKEN_HERE"');
  process.exit(1);
}

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('ERROR: Version argument required.');
  console.error('  Usage: node scripts/create-release.js <version> [release-notes]');
  console.error('  Example: node scripts/create-release.js 5.3.0');
  process.exit(1);
}

const OWNER = process.env.GITHUB_OWNER || 'TechMW26';
const REPO = process.env.GITHUB_REPO || 'Talio';
const TAG = 'v' + VERSION;

const RELEASE_NOTES = process.argv[3] || `## Talio Desktop v${VERSION}

### Downloads

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | Talio-${VERSION}-arm64.dmg |
| macOS (Intel) | Talio-${VERSION}-x64.dmg |
| Windows | Talio.Setup.${VERSION}.exe |`;

const ASSETS = [
  { file: `Talio-${VERSION}-arm64.dmg`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-x64.dmg`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-arm64.zip`, type: 'application/zip' },
  { file: `Talio-${VERSION}-x64.zip`, type: 'application/zip' },
  { file: `Talio.Setup.${VERSION}.exe`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-x86_64.AppImage`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-amd64.deb`, type: 'application/vnd.debian.binary-package' },
];

function githubRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        'Authorization': 'token ' + TOKEN,
        'User-Agent': 'Talio-Release-Script',
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers,
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function uploadAsset(uploadUrl, filePath, contentType) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const url = new URL(uploadUrl.replace('{?name,label}', '') + '?name=' + encodeURIComponent(fileName));
    
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': 'token ' + TOKEN,
        'User-Agent': 'Talio-Release-Script',
        'Content-Type': contentType,
        'Content-Length': fileData.length,
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.write(fileData);
    req.end();
  });
}

async function main() {
  const distDir = path.join(__dirname, '..', 'dist');
  const missingAssets = ASSETS.filter(asset => !fs.existsSync(path.join(distDir, asset.file)));
  if (missingAssets.length) {
    console.error('ERROR: Missing release assets:', missingAssets.map(asset => asset.file).join(', '));
    process.exit(1);
  }
  for (const asset of ASSETS) {
    if (fs.statSync(path.join(distDir, asset.file)).size < 1024 * 1024) throw new Error('Invalid or truncated installer: ' + asset.file);
    if (asset.file.endsWith('.deb')) {
      const result = require('child_process').spawnSync('ar', ['t', path.join(distDir, asset.file)], { encoding: 'utf8' });
      if (result.status !== 0 || !result.stdout.includes('debian-binary') || !result.stdout.includes('data.tar')) throw new Error('Invalid Debian package: ' + asset.file);
    }
  }
  const checksums = ASSETS.map(asset => {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir, asset.file))).digest('hex');
    return `${digest}  ${asset.file}`;
  }).join('\n') + '\n';
  fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), checksums);
  ASSETS.push({ file: 'SHA256SUMS.txt', type: 'text/plain' });

  // Step 1: Create release
  console.log('Creating release ' + TAG + '...');
  const releaseBody = JSON.stringify({
    tag_name: TAG,
    target_commitish: process.env.RELEASE_COMMIT || 'main',
    name: 'Talio Desktop ' + TAG,
    body: RELEASE_NOTES,
    draft: true,
    prerelease: false,
  });

  const resumeId = process.env.RESUME_RELEASE_ID;
  const release = resumeId ? await githubRequest({ hostname: 'api.github.com', path: `/repos/${OWNER}/${REPO}/releases/${resumeId}`, method: 'GET' }) : await githubRequest({
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(releaseBody) }
  }, releaseBody);

  if (release.status !== (resumeId ? 200 : 201)) {
    console.error('Failed to create release:', release.status, JSON.stringify(release.data, null, 2));
    process.exit(1);
  }
  if (resumeId && (!release.data.draft || release.data.tag_name !== TAG)) throw new Error('Can only resume the matching draft release');

  console.log('Release created! ID:', release.data.id);
  console.log('URL:', release.data.html_url);
  const uploadUrl = release.data.upload_url;

  // Step 2: Upload assets
  let uploadFailed = false;
  for (const asset of ASSETS) {
    const filePath = path.join(distDir, asset.file);
    const existing = release.data.assets?.find(item => item.name === asset.file && item.state === 'uploaded');
    if (existing && existing.digest === 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')) {
      console.log('Already uploaded and hash verified: ' + asset.file);
      continue;
    }
    if (existing) throw new Error('Existing draft asset does not match: ' + asset.file);
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${asset.file} (${sizeMB} MB)...`);
    const result = await uploadAsset(uploadUrl, filePath, asset.type);
    if (result.status === 201) {
      console.log('  ✓ Uploaded:', result.data.name, '(' + result.data.state + ')');
    } else {
      console.error('  ✗ Failed:', result.status, JSON.stringify(result.data).substring(0, 200));
      uploadFailed = true;
    }
  }

  if (uploadFailed) {
    console.error('\nRelease created, but one or more assets failed to upload.');
    process.exit(1);
  }

  const published = await githubRequest({
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases/${release.data.id}`,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ draft: false, make_latest: 'true' }));
  if (published.status !== 200) throw new Error('Assets uploaded, but publishing failed: ' + published.status);

  console.log('\nDone! Release URL:', release.data.html_url);
}

main().catch(err => { console.error(err); process.exit(1); });
