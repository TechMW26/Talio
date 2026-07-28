const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_GITHUB_OWNER = 'TechMW26';
const DEFAULT_GITHUB_REPO = 'Talio';
const DEFAULT_STORAGE_PATH = process.env.NODE_ENV === 'production'
    ? '/var/www/talio/releases'
    : path.join(process.cwd(), 'releases');

const METADATA_FILE = 'latest.json';
const LATEST_POINTER = 'latest';
const LOG_PREFIX = '[ReleaseSync]';

const PLATFORM_DOWNLOADS = {
    windows: {
        platform: 'windows',
        label: 'Windows 10/11 (64-bit)',
        path: '/download/windows',
        pattern: /Talio\.Setup\..*\.exe$/i,
    },
    mac: {
        platform: 'mac',
        label: 'macOS',
        path: '/download/mac',
        pattern: /Talio-.*-arm64\.dmg$/i,
    },
    'mac-arm64': {
        platform: 'mac-arm64',
        label: 'Apple Silicon (M-series)',
        path: '/download/mac-arm64',
        pattern: /Talio-.*-arm64\.dmg$/i,
    },
    'mac-intel': {
        platform: 'mac-intel',
        label: 'Intel (x64)',
        path: '/download/mac-intel',
        pattern: /Talio-.*-x64\.dmg$/i,
    },
    linux: {
        platform: 'linux',
        label: 'Linux',
        path: '/download/linux',
        pattern: /Talio-.*\.(appimage|deb|rpm|tar\.gz)$/i,
    },
};

let syncPromise = null;

function logInfo(message, meta) {
    console.log(`${LOG_PREFIX} ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

function logWarn(message, meta) {
    console.warn(`${LOG_PREFIX} ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

function logError(message, error) {
    const detail = error?.message || error;
    console.error(`${LOG_PREFIX} ${message}${detail ? `: ${detail}` : ''}`);
}

function getReleaseConfig() {
    return {
        owner: process.env.GITHUB_OWNER || DEFAULT_GITHUB_OWNER,
        repo: process.env.GITHUB_REPO || DEFAULT_GITHUB_REPO,
        token: process.env.GITHUB_RELEASE_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
        storagePath: process.env.RELEASE_STORAGE_PATH || DEFAULT_STORAGE_PATH,
        assetName: process.env.RELEASE_ASSET_NAME || '',
        assetPattern: process.env.RELEASE_ASSET_PATTERN || '',
    };
}

function getStoragePath() {
    return path.resolve(getReleaseConfig().storagePath);
}

function getMetadataPath() {
    return path.join(getStoragePath(), METADATA_FILE);
}

function getLatestPointerPath() {
    return path.join(getStoragePath(), LATEST_POINTER);
}

async function ensureStorageDirectory() {
    const storagePath = getStoragePath();
    await fs.promises.mkdir(storagePath, { recursive: true, mode: 0o755 });
    await fs.promises.chmod(storagePath, 0o755).catch(() => { });
    return storagePath;
}

function safePathSegment(value, fallback = 'release') {
    const cleaned = path.basename(String(value || fallback))
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+/, '')
        .slice(0, 180);

    return cleaned || fallback;
}

function safeAssetName(name) {
    return safePathSegment(name, 'release-asset');
}

function formatAssetSize(sizeBytes) {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return '';
    }

    const mb = sizeBytes / (1024 * 1024);
    return `${Math.max(1, Math.round(mb))} MB`;
}

function findPlatformAsset(assets, pattern) {
    return assets.find((asset) => {
        if (!asset?.name) return false;
        return pattern.test(asset.name);
    }) || null;
}

function buildGitHubHeaders(accept = 'application/vnd.github+json') {
    const { token } = getReleaseConfig();
    const headers = {
        Accept: accept,
        'User-Agent': 'Talio-Release-Sync',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

async function githubFetchJson(url) {
    const response = await fetch(url, {
        headers: buildGitHubHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
    }

    return response.json();
}

function getGitHubApiBase() {
    const { owner, repo } = getReleaseConfig();
    return `https://api.github.com/repos/${owner}/${repo}`;
}

async function fetchLatestRelease() {
    logInfo('Detecting latest GitHub release');
    return githubFetchJson(`${getGitHubApiBase()}/releases/latest`);
}

async function fetchReleaseById(releaseId) {
    return githubFetchJson(`${getGitHubApiBase()}/releases/${releaseId}`);
}

function compileAssetPattern(pattern) {
    if (!pattern) return null;

    try {
        return new RegExp(pattern);
    } catch (error) {
        logWarn('Ignoring invalid RELEASE_ASSET_PATTERN', { pattern });
        return null;
    }
}

function selectReleaseAsset(release) {
    const assets = Array.isArray(release?.assets)
        ? release.assets.filter((asset) => asset?.name && (!asset.state || asset.state === 'uploaded'))
        : [];

    if (assets.length === 0) {
        throw new Error(`No downloadable release assets found for ${release?.tag_name || 'latest release'}`);
    }

    const { assetName, assetPattern } = getReleaseConfig();
    if (assetName) {
        const exactMatch = assets.find((asset) => asset.name === assetName);
        if (!exactMatch) {
            throw new Error(`Release asset named "${assetName}" was not found in ${release.tag_name}`);
        }
        return exactMatch;
    }

    const pattern = compileAssetPattern(assetPattern);
    if (pattern) {
        const patternMatch = assets.find((asset) => pattern.test(asset.name));
        if (!patternMatch) {
            throw new Error(`No release asset matched RELEASE_ASSET_PATTERN for ${release.tag_name}`);
        }
        return patternMatch;
    }

    const installerLike = assets.find((asset) => /\.(dmg|exe|msi|pkg|zip|appimage|deb|rpm)$/i.test(asset.name));
    if (installerLike) {
        return installerLike;
    }

    return assets.find((asset) => !/\.(blockmap|ya?ml|sha256|sha512|txt)$/i.test(asset.name)) || assets[0];
}

async function fileExists(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.isFile();
    } catch {
        return false;
    }
}

async function readJsonFile(filePath) {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function writeJsonAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
    await fs.promises.rename(tmpPath, filePath);
    await fs.promises.chmod(filePath, 0o644).catch(() => { });
}

async function updateLatestPointer(storagePath, targetPath) {
    const latestPath = getLatestPointerPath();
    const tmpPath = path.join(storagePath, `.latest.tmp-${process.pid}-${Date.now()}`);
    const relativeTarget = path.relative(storagePath, targetPath);

    await fs.promises.unlink(tmpPath).catch(() => { });

    try {
        await fs.promises.symlink(relativeTarget, tmpPath);
        await fs.promises.rename(tmpPath, latestPath);
    } catch (error) {
        await fs.promises.unlink(tmpPath).catch(() => { });
        logWarn('Symlink update failed, copying latest asset instead', { reason: error.message });
        const tmpCopyPath = `${latestPath}.tmp-${process.pid}-${Date.now()}`;
        await fs.promises.copyFile(targetPath, tmpCopyPath);
        await fs.promises.rename(tmpCopyPath, latestPath);
    }

    await fs.promises.chmod(latestPath, 0o644).catch(() => { });
    logInfo('Latest release URL updated', { latestPath });
}

async function downloadAsset(asset, targetPath) {
    const downloadUrl = asset.url || asset.browser_download_url;
    if (!downloadUrl) {
        throw new Error(`Release asset ${asset.name} does not include a download URL`);
    }

    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.unlink(tmpPath).catch(() => { });

    try {
        const response = await fetch(downloadUrl, {
            headers: buildGitHubHeaders('application/octet-stream'),
            redirect: 'follow',
            cache: 'no-store',
            signal: AbortSignal.timeout(10 * 60 * 1000),
        });

        if (!response.ok) {
            throw new Error(`GitHub asset download returned ${response.status}`);
        }

        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpPath, { mode: 0o644 }));
        await fs.promises.rename(tmpPath, targetPath);
        await fs.promises.chmod(targetPath, 0o644).catch(() => { });
        logInfo('Asset downloaded successfully', { fileName: asset.name, targetPath });
    } catch (error) {
        await fs.promises.unlink(tmpPath).catch(() => { });
        throw error;
    }
}

async function getCurrentReleaseMetadata() {
    return readJsonFile(getMetadataPath());
}

async function doSyncRelease(release, options = {}) {
    if (!release?.id && !release?.tag_name) {
        throw new Error('Release payload is missing an id or tag name');
    }

    let fullRelease = release;
    if (release.id && (!Array.isArray(release.assets) || release.assets.length === 0)) {
        fullRelease = await fetchReleaseById(release.id);
    }

    const asset = selectReleaseAsset(fullRelease);
    const version = fullRelease.tag_name || `release-${fullRelease.id}`;
    const storagePath = await ensureStorageDirectory();
    const versionDir = path.join(storagePath, safePathSegment(version));
    await fs.promises.mkdir(versionDir, { recursive: true, mode: 0o755 });
    await fs.promises.chmod(versionDir, 0o755).catch(() => { });

    const fileName = safeAssetName(asset.name);
    const targetPath = path.join(versionDir, fileName);
    const current = await getCurrentReleaseMetadata();

    logInfo('Release version detected', { version, asset: asset.name, source: options.source || 'manual' });

    if (
        current?.version === version &&
        current?.asset_id === asset.id &&
        current?.file_path &&
        await fileExists(current.file_path)
    ) {
        logInfo('Latest release already downloaded', { version, fileName: current.file_name });
        return { updated: false, metadata: current };
    }

    await downloadAsset(asset, targetPath);
    await updateLatestPointer(storagePath, targetPath);

    const metadata = {
        version,
        release_id: fullRelease.id || null,
        release_name: fullRelease.name || version,
        release_url: fullRelease.html_url || null,
        file_name: fileName,
        original_file_name: asset.name,
        asset_id: asset.id || null,
        asset_size: asset.size || null,
        content_type: asset.content_type || 'application/octet-stream',
        published_at: fullRelease.published_at || fullRelease.created_at || null,
        downloaded_at: new Date().toISOString(),
        file_path: targetPath,
        latest_path: getLatestPointerPath(),
        source: options.source || 'manual',
    };

    await writeJsonAtomic(getMetadataPath(), metadata);
    return { updated: true, metadata };
}

function syncRelease(release, options = {}) {
    if (syncPromise) {
        logInfo('Release sync already running; waiting for current sync');
        return syncPromise;
    }

    syncPromise = doSyncRelease(release, options)
        .catch((error) => {
            logError('Release sync failed', error);
            throw error;
        })
        .finally(() => {
            syncPromise = null;
        });

    return syncPromise;
}

async function syncLatestReleaseFromGitHub(options = {}) {
    try {
        const release = await fetchLatestRelease();
        return syncRelease(release, { ...options, source: options.source || 'latest-api' });
    } catch (error) {
        logError('Error during GitHub API call', error);
        throw error;
    }
}

async function syncReleaseFromWebhookPayload(releasePayload, options = {}) {
    const release = releasePayload?.id ? await fetchReleaseById(releasePayload.id) : releasePayload;
    return syncRelease(release, { ...options, source: options.source || 'webhook' });
}

function getPublicBaseUrl(request) {
    const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (envBaseUrl) return envBaseUrl.replace(/\/$/, '');

    const origin = request?.nextUrl?.origin || request?.headers?.get?.('origin');
    return origin ? origin.replace(/\/$/, '') : '';
}

function buildUnavailableDownload(config, reason) {
    return {
        platform: config.platform,
        label: config.label,
        fileName: '',
        sizeLabel: '',
        downloadUrl: null,
        isAvailable: false,
        unavailableReason: reason,
    };
}

function buildPlatformDownloads(baseUrl, latestRelease, metadata) {
    const downloads = {};
    const assets = Array.isArray(latestRelease?.assets)
        ? latestRelease.assets.filter((asset) => asset?.name && (!asset.state || asset.state === 'uploaded'))
        : [];

    const hasGitHubAssets = assets.length > 0;

    for (const [key, config] of Object.entries(PLATFORM_DOWNLOADS)) {
        const platformAsset = findPlatformAsset(assets, config.pattern);
        if (platformAsset) {
            downloads[key] = {
                platform: config.platform,
                label: config.label,
                fileName: platformAsset.name,
                sizeLabel: formatAssetSize(platformAsset.size),
                downloadUrl: `${baseUrl}${config.path}`,
                isAvailable: true,
            };
            continue;
        }

        // When GitHub API metadata isn't available (private repo without token),
        // fallback to the locally synced latest artifact if it matches this platform.
        if (!hasGitHubAssets && metadata?.file_name && config.pattern.test(metadata.file_name)) {
            downloads[key] = {
                platform: config.platform,
                label: config.label,
                fileName: metadata.file_name,
                sizeLabel: formatAssetSize(metadata.asset_size),
                downloadUrl: `${baseUrl}/download/latest`,
                isAvailable: true,
            };
            continue;
        }

        downloads[key] = buildUnavailableDownload(
            config,
            hasGitHubAssets ? 'Not published in latest release' : 'GitHub release access required'
        );
    }

    return downloads;
}

async function getPublicReleaseMetadata(request) {
    const metadata = await getCurrentReleaseMetadata();
    if (!metadata) return null;

    const baseUrl = getPublicBaseUrl(request);
    const downloadUrl = `${baseUrl}/download/latest`;

    let latestRelease = null;
    try {
        latestRelease = await fetchLatestRelease();
    } catch (error) {
        logWarn('Unable to fetch latest GitHub release for platform metadata', { reason: error.message });
    }

    const tagName = metadata.version || latestRelease?.tag_name || null;
    const publishedAt = metadata.published_at || latestRelease?.published_at || null;
    const versionName = metadata.release_name || (tagName ? `Talio Desktop ${tagName}` : null);
    const downloads = buildPlatformDownloads(baseUrl, latestRelease, metadata);

    return {
        tagName,
        version: versionName,
        versionTag: tagName,
        publishedAt,
        downloads,
        release_version: metadata.version,
        download_url: downloadUrl,
        file_name: metadata.file_name,
        published_at: metadata.published_at,
        release_name: metadata.release_name,
        asset_size: metadata.asset_size,
        content_type: metadata.content_type,
        downloaded_at: metadata.downloaded_at,
        release_url: metadata.release_url,
    };
}

async function resolveLatestReleaseFile() {
    const storagePath = await ensureStorageDirectory();
    const latestPath = getLatestPointerPath();
    const metadata = await getCurrentReleaseMetadata();

    let storageRealPath;
    let latestRealPath;
    try {
        storageRealPath = await fs.promises.realpath(storagePath);
        latestRealPath = await fs.promises.realpath(latestPath);
    } catch {
        throw new Error('Latest release file is not available yet');
    }

    const storageRoot = storageRealPath.endsWith(path.sep) ? storageRealPath : `${storageRealPath}${path.sep}`;
    if (!latestRealPath.startsWith(storageRoot)) {
        throw new Error('Latest release pointer resolves outside the release directory');
    }

    const stats = await fs.promises.stat(latestRealPath);
    if (!stats.isFile()) {
        throw new Error('Latest release pointer does not resolve to a file');
    }

    return {
        latestPath,
        realPath: latestRealPath,
        metadata,
        stats,
    };
}

function buildContentDisposition(fileName) {
    const safeName = safeAssetName(fileName || 'latest-release');
    const asciiName = safeName.replace(/["\\]/g, '_');
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function verifyGitHubSignature(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader) return false;

    const prefix = 'sha256=';
    if (!signatureHeader.startsWith(prefix)) return false;

    const providedHex = signatureHeader.slice(prefix.length);
    const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');

    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
}

module.exports = {
    buildContentDisposition,
    getCurrentReleaseMetadata,
    getLatestPointerPath,
    getPublicReleaseMetadata,
    getReleaseConfig,
    resolveLatestReleaseFile,
    syncLatestReleaseFromGitHub,
    syncReleaseFromWebhookPayload,
    verifyGitHubSignature,
};
