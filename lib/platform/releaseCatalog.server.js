import crypto from 'crypto'

const DEFAULT_GITHUB_OWNER = 'TechMW26'
const DEFAULT_GITHUB_REPO = 'Talio'

export const RELEASE_PLATFORMS = Object.freeze({
  windows: {
    aliases: ['windows', 'win'],
    label: 'Windows 10/11 (64-bit)',
    pattern: /Talio\.Setup\..*\.exe$/i,
  },
  'mac-arm64': {
    aliases: ['mac-arm64', 'mac'],
    label: 'Apple Silicon (M-series)',
    pattern: /Talio-.*-arm64\.dmg$/i,
  },
  'mac-intel': {
    aliases: ['mac-intel'],
    label: 'Intel (x64)',
    pattern: /Talio-.*-x64\.dmg$/i,
  },
  linux: {
    aliases: ['linux'],
    label: 'Linux',
    pattern: /Talio-.*\.(appimage|deb|rpm|tar\.gz)$/i,
  },
})

function getReleaseConfig(env = process.env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_GITHUB_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_GITHUB_REPO,
    token: env.GITHUB_RELEASE_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || '',
    assetName: env.RELEASE_ASSET_NAME || '',
  }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Talio-Release-Catalog',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function fetchLatestGitHubRelease({
  env = process.env,
  fetchImpl = fetch,
  cache = 'no-store',
} = {}) {
  const config = getReleaseConfig(env)
  const response = await fetchImpl(
    `https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`,
    {
      headers: githubHeaders(config.token),
      cache,
      signal: AbortSignal.timeout(15_000),
    },
  )

  if (!response.ok) {
    const error = new Error(`GitHub release API returned ${response.status}`)
    error.code = 'GITHUB_RELEASE_UNAVAILABLE'
    error.status = response.status
    throw error
  }

  return response.json()
}

function publishedAssets(release) {
  return Array.isArray(release?.assets)
    ? release.assets.filter((asset) => (
        asset?.name
        && asset?.browser_download_url
        && (!asset.state || asset.state === 'uploaded')
      ))
    : []
}

export function getCanonicalPlatform(platform) {
  const normalized = String(platform || '').trim().toLowerCase()
  return Object.entries(RELEASE_PLATFORMS)
    .find(([, config]) => config.aliases.includes(normalized))?.[0] || null
}

export function selectReleaseAssetForPlatform(release, platform) {
  const canonical = getCanonicalPlatform(platform)
  if (!canonical) return null
  return publishedAssets(release).find((asset) => (
    RELEASE_PLATFORMS[canonical].pattern.test(asset.name)
  )) || null
}

export function selectDefaultReleaseAsset(release, env = process.env) {
  const assets = publishedAssets(release)
  const configuredName = getReleaseConfig(env).assetName
  if (configuredName) {
    return assets.find((asset) => asset.name === configuredName) || null
  }

  return selectReleaseAssetForPlatform(release, 'windows')
    || selectReleaseAssetForPlatform(release, 'mac-arm64')
    || selectReleaseAssetForPlatform(release, 'mac-intel')
    || selectReleaseAssetForPlatform(release, 'linux')
    || assets.find((asset) => !/\.(blockmap|ya?ml|sha256|sha512|txt)$/i.test(asset.name))
    || null
}

function formatAssetSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return ''
  return `${Math.max(1, Math.round(sizeBytes / (1024 * 1024)))} MB`
}

function getPublicBaseUrl(request, env = process.env) {
  const configured = env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || env.APP_URL
  if (configured) return configured.replace(/\/$/, '')

  const origin = request?.nextUrl?.origin || request?.headers?.get?.('origin')
  return origin ? origin.replace(/\/$/, '') : ''
}

export function buildPublicReleaseMetadata(release, request, env = process.env) {
  const baseUrl = getPublicBaseUrl(request, env)
  const downloads = {}

  for (const [platform, config] of Object.entries(RELEASE_PLATFORMS)) {
    const asset = selectReleaseAssetForPlatform(release, platform)
    downloads[platform] = asset
      ? {
          platform,
          label: config.label,
          fileName: asset.name,
          sizeLabel: formatAssetSize(asset.size),
          downloadUrl: `${baseUrl}/download/${platform}`,
          isAvailable: true,
        }
      : {
          platform,
          label: config.label,
          fileName: '',
          sizeLabel: '',
          downloadUrl: null,
          isAvailable: false,
          unavailableReason: 'Not published in latest release',
        }
  }

  // Preserve the historic `mac` key used by the current download UI.
  downloads.mac = {
    ...downloads['mac-arm64'],
    platform: 'mac',
    downloadUrl: downloads['mac-arm64'].isAvailable ? `${baseUrl}/download/mac` : null,
  }

  const defaultAsset = selectDefaultReleaseAsset(release, env)
  const version = release?.tag_name || null

  return {
    tagName: version,
    version: release?.name || (version ? `Talio Desktop ${version}` : null),
    versionTag: version,
    publishedAt: release?.published_at || release?.created_at || null,
    downloads,
    release_version: version,
    download_url: defaultAsset ? `${baseUrl}/download/latest` : null,
    file_name: defaultAsset?.name || null,
    published_at: release?.published_at || release?.created_at || null,
    release_name: release?.name || version,
    asset_size: defaultAsset?.size || null,
    content_type: defaultAsset?.content_type || 'application/octet-stream',
    downloaded_at: null,
    release_url: release?.html_url || null,
  }
}

export function verifyGitHubWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false

  const supplied = Buffer.from(signatureHeader.slice(7), 'hex')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest()

  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

export async function getPublicReleaseMetadata(request, options = {}) {
  const release = await fetchLatestGitHubRelease(options)
  return buildPublicReleaseMetadata(release, request, options.env || process.env)
}
