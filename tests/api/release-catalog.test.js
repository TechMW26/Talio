import {
  buildPublicReleaseMetadata,
  getCanonicalPlatform,
  selectDefaultReleaseAsset,
  selectReleaseAssetForPlatform,
  verifyGitHubWebhookSignature,
} from '@/lib/platform/releaseCatalog.server'
import crypto from 'crypto'

const release = {
  tag_name: 'v2.4.0',
  name: 'Talio Desktop 2.4.0',
  published_at: '2026-08-31T10:00:00.000Z',
  html_url: 'https://github.com/TechMW26/Talio/releases/tag/v2.4.0',
  assets: [
    { name: 'latest.yml', browser_download_url: 'https://assets/latest.yml', size: 100 },
    { name: 'Talio.Setup.2.4.0.exe', browser_download_url: 'https://assets/windows', size: 100_000_000 },
    { name: 'Talio-2.4.0-arm64.dmg', browser_download_url: 'https://assets/arm', size: 90_000_000 },
    { name: 'Talio-2.4.0-x64.dmg', browser_download_url: 'https://assets/intel', size: 95_000_000 },
  ],
}

describe('serverless desktop release catalog', () => {
  test('normalizes platform aliases and rejects unknown platforms', () => {
    expect(getCanonicalPlatform('mac')).toBe('mac-arm64')
    expect(getCanonicalPlatform('WIN')).toBe('windows')
    expect(getCanonicalPlatform('android')).toBeNull()
  })

  test('selects exact platform assets and a stable default', () => {
    expect(selectReleaseAssetForPlatform(release, 'mac-intel')?.name).toContain('x64.dmg')
    expect(selectReleaseAssetForPlatform(release, 'linux')).toBeNull()
    expect(selectDefaultReleaseAsset(release)?.name).toContain('.exe')
  })

  test('honors an explicitly configured default asset', () => {
    expect(selectDefaultReleaseAsset(release, {
      RELEASE_ASSET_NAME: 'Talio-2.4.0-arm64.dmg',
    })?.name).toContain('arm64.dmg')
  })

  test('builds backward-compatible metadata without local filesystem state', () => {
    const metadata = buildPublicReleaseMetadata(release, undefined, {
      NEXT_PUBLIC_APP_URL: 'https://app.talio.in/',
    })

    expect(metadata).toMatchObject({
      versionTag: 'v2.4.0',
      file_name: 'Talio.Setup.2.4.0.exe',
      download_url: 'https://app.talio.in/download/latest',
    })
    expect(metadata.downloads.windows.downloadUrl).toBe('https://app.talio.in/download/windows')
    expect(metadata.downloads.mac.downloadUrl).toBe('https://app.talio.in/download/mac')
    expect(metadata.downloads.linux.isAvailable).toBe(false)
  })

  test('verifies webhook signatures using constant-time byte comparison', () => {
    const body = JSON.stringify({ action: 'published' })
    const secret = 'webhook-secret'
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`

    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true)
    expect(verifyGitHubWebhookSignature(body, `${signature}00`, secret)).toBe(false)
    expect(verifyGitHubWebhookSignature(body, '', secret)).toBe(false)
  })
})
