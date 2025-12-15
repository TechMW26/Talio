/**
 * Talio Desktop App Release Configuration
 *
 * Update this file when releasing new versions.
 * All download pages will automatically use these URLs.
 */

const RELEASE_CONFIG = {
  version: '1.2.0',
  github: {
    owner: 'avirajsharma-ops',
    repo: 'Talio'
  },
  downloads: {
    mac: {
      arm64: {
        filename: 'Talio-macOS-ARM.dmg',
        size: '~91 MB',
        label: 'Apple Silicon (M1/M2/M3/M4)'
      },
      x64: {
        filename: 'Talio-macOS-Intel.dmg',
        size: '~95 MB',
        label: 'Intel (x64)'
      }
    },
    windows: {
      x64: {
        filename: 'Talio-Windows.exe',
        size: '~160 MB',
        label: 'Windows (32-bit & 64-bit)'
      },
      ia32: {
        filename: 'Talio-Windows.exe',
        size: '~160 MB',
        label: 'Windows (32-bit & 64-bit)'
      }
    }
  }
};

// Generate download URLs from config
const getDownloadUrl = (platform, arch) => {
  const { github, version, downloads } = RELEASE_CONFIG;
  const download = downloads[platform]?.[arch];
  if (!download) return null;
  return `https://github.com/${github.owner}/${github.repo}/releases/download/v${version}/${download.filename}`;
};

// Get all download URLs for a platform
const getPlatformDownloads = (platform) => {
  const { downloads } = RELEASE_CONFIG;
  const platformDownloads = downloads[platform];
  if (!platformDownloads) return null;

  const result = {};
  for (const [arch, config] of Object.entries(platformDownloads)) {
    result[arch] = {
      ...config,
      url: getDownloadUrl(platform, arch)
    };
  }
  return result;
};

// Export for use in both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RELEASE_CONFIG, getDownloadUrl, getPlatformDownloads };
}

// For browser/ES modules
if (typeof window !== 'undefined') {
  window.RELEASE_CONFIG = RELEASE_CONFIG;
  window.getDownloadUrl = getDownloadUrl;
  window.getPlatformDownloads = getPlatformDownloads;
}

export { RELEASE_CONFIG, getDownloadUrl, getPlatformDownloads };

