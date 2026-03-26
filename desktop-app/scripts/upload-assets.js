#!/usr/bin/env node
/**
 * Upload assets to an existing GitHub Release (looked up by tag).
 * Automatically deletes and re-uploads if assets already exist.
 *
 * Usage:
 *   node scripts/upload-assets.js <version>
 *
 * Example:
 *   node scripts/upload-assets.js 5.3.0
 *
 * Environment:
 *   GH_TOKEN  — GitHub Personal Access Token (required)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GH_TOKEN environment variable is required.');
  console.error('  export GH_TOKEN="ghp_YOUR_TOKEN_HERE"');
  process.exit(1);
}

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('ERROR: Version argument required.');
  console.error('  Usage: node scripts/upload-assets.js <version>');
  console.error('  Example: node scripts/upload-assets.js 5.3.0');
  process.exit(1);
}

const OWNER = 'avirajsharma-ops';
const REPO = 'Talio';
const TAG = 'v' + VERSION;

const ASSETS = [
  { file: `Talio-${VERSION}-arm64.dmg`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-x64.dmg`, type: 'application/octet-stream' },
  { file: `Talio-${VERSION}-arm64.zip`, type: 'application/zip' },
  { file: `Talio-${VERSION}-x64.zip`, type: 'application/zip' },
  { file: `Talio.Setup.${VERSION}.exe`, type: 'application/octet-stream' },
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
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function uploadAsset(releaseId, filePath, contentType) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const uploadPath = `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;
    
    console.log(`  Uploading to uploads.github.com${uploadPath}`);
    
    const req = https.request({
      hostname: 'uploads.github.com',
      path: uploadPath,
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
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    req.write(fileData);
    req.end();
  });
}

async function main() {
  const distDir = path.join(__dirname, '..', 'dist');

  // Look up release by tag
  console.log('Looking up release for tag ' + TAG + '...');
  const tagLookup = await githubRequest({
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
    method: 'GET',
  });

  if (tagLookup.status !== 200) {
    console.error('Release not found for tag ' + TAG + '. Create it first with:');
    console.error('  node scripts/create-release.js ' + VERSION);
    process.exit(1);
  }

  const releaseId = tagLookup.data.id;
  console.log('Found release ID:', releaseId);

  const existingNames = (tagLookup.data.assets || []).map(a => a.name);
  console.log('Existing assets:', existingNames.length ? existingNames.join(', ') : 'none');

  // Delete existing assets that we want to re-upload
  for (const asset of (tagLookup.data.assets || [])) {
    const wantedFiles = ASSETS.map(a => a.file);
    if (wantedFiles.includes(asset.name)) {
      console.log('Deleting existing asset:', asset.name);
      await githubRequest({
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`,
        method: 'DELETE',
      });
    }
  }

  // Upload each asset
  for (const asset of ASSETS) {
    const filePath = path.join(distDir, asset.file);
    if (!fs.existsSync(filePath)) {
      console.log('SKIP (not found):', asset.file);
      continue;
    }
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${asset.file} (${sizeMB} MB)...`);
    const result = await uploadAsset(releaseId, filePath, asset.type);
    if (result.status === 201) {
      console.log('  ✓ Uploaded:', result.data.name, '(' + result.data.state + ')');
    } else {
      console.error('  ✗ Failed:', result.status, JSON.stringify(result.data).substring(0, 300));
    }
  }

  console.log('\nDone! Release: https://github.com/' + OWNER + '/' + REPO + '/releases/tag/' + TAG);
}

main().catch(err => { console.error(err); process.exit(1); });
