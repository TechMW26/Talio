'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button, Chip, Spinner } from '@heroui/react'
import {
  HiOutlineComputerDesktop,
  HiOutlineArrowPath,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlineCpuChip,
  HiOutlineFolder,
  HiOutlineGlobeAlt,
  HiOutlineArrowDownTray,
} from 'react-icons/hi2'

export default function AppInfoPage() {
  const [appInfo, setAppInfo] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [latestVersion, setLatestVersion] = useState(null)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [updateVersion, setUpdateVersion] = useState(null)
  const [updateError, setUpdateError] = useState(null)
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    const hasElectron = typeof window !== 'undefined' && (window.electronAPI !== undefined || window.isElectron === true)
    setIsElectron(hasElectron)

    // Get app info — try full info first, fallback to just version
    if (hasElectron && window.electronAPI) {
      if (window.electronAPI.getAppInfo) {
        window.electronAPI.getAppInfo().then(info => {
          setAppInfo(info)
          setCurrentVersion(info.version)
        }).catch(() => {
          // getAppInfo not available on older versions, try getAppVersion
          if (window.electronAPI.getAppVersion) {
            window.electronAPI.getAppVersion().then(version => {
              setCurrentVersion(version)
              setAppInfo({ version })
            }).catch(() => {})
          }
        })
      } else if (window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(version => {
          setCurrentVersion(version)
          setAppInfo({ version })
        }).catch(() => {})
      }

      // Listen for update status events from main process
      if (window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
          setUpdateStatus(data.status)
          if (data.version) setUpdateVersion(data.version)
          if (data.message) setUpdateError(data.message)
        })
      }
    }

    // Always fetch latest version from web API (works even on outdated apps)
    fetch('/api/desktop/min-version')
      .then(res => res.json())
      .then(data => {
        if (data.latestVersion) setLatestVersion(data.latestVersion)
      })
      .catch(() => {})

    return () => {
      if (hasElectron && window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('update-status')
      }
    }
  }, [])

  const handleCheckUpdate = useCallback(() => {
    if (window.electronAPI?.checkForUpdate) {
      setUpdateStatus('checking')
      setUpdateError(null)
      setUpdateVersion(null)
      window.electronAPI.checkForUpdate({ silent: true })
    } else if (window.electronAPI?.startUpdate) {
      // Older apps may have startUpdate but not the silent option
      setUpdateStatus('checking')
      window.electronAPI.startUpdate()
    }
  }, [])

  if (!isElectron) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <HiOutlineComputerDesktop className="w-16 h-16 mx-auto text-default-300" />
          <h2 className="text-xl font-semibold text-default-700">Desktop App Only</h2>
          <p className="text-default-500 text-sm max-w-sm">
            App Info is only available in the Talio Desktop application.
          </p>
        </div>
      </div>
    )
  }

  const platformLabel = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  }

  const archLabel = {
    arm64: 'Apple Silicon (ARM64)',
    x64: 'Intel (x64)',
    ia32: 'x86 (32-bit)',
  }

  // Compare versions to check if outdated
  const isOutdated = currentVersion && latestVersion && currentVersion !== latestVersion

  // Build info rows from whatever data we have
  const infoRows = []
  if (appInfo) {
    infoRows.push({ icon: HiOutlineInformationCircle, label: 'App Version', value: `v${appInfo.version}` })
    if (appInfo.platform) infoRows.push({ icon: HiOutlineComputerDesktop, label: 'Platform', value: platformLabel[appInfo.platform] || appInfo.platform })
    if (appInfo.arch) infoRows.push({ icon: HiOutlineCpuChip, label: 'Architecture', value: archLabel[appInfo.arch] || appInfo.arch })
    if (appInfo.electronVersion) infoRows.push({ icon: HiOutlineGlobeAlt, label: 'Electron', value: `v${appInfo.electronVersion}` })
    if (appInfo.chromeVersion) infoRows.push({ icon: HiOutlineGlobeAlt, label: 'Chromium', value: `v${appInfo.chromeVersion}` })
    if (appInfo.nodeVersion) infoRows.push({ icon: HiOutlineCpuChip, label: 'Node.js', value: `v${appInfo.nodeVersion}` })
    if (appInfo.userDataPath) infoRows.push({ icon: HiOutlineFolder, label: 'User Data', value: appInfo.userDataPath })
    if (appInfo.appPath) infoRows.push({ icon: HiOutlineFolder, label: 'App Path', value: appInfo.appPath })
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl" style={{ backgroundColor: 'var(--color-primary-100)' }}>
          <img src="/assets/lanyard-card-logo.webp" alt="Talio" className="w-10 h-10 object-contain" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Talio Desktop</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
            {currentVersion ? `Version ${currentVersion}` : 'Loading...'}
            {appInfo?.platform ? ` • ${platformLabel[appInfo.platform] || appInfo.platform}` : ''}
            {appInfo?.arch ? ` (${archLabel[appInfo.arch] || appInfo.arch})` : ''}
          </p>
        </div>
      </div>

      {/* Update Section */}
      <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--color-primary-200)', backgroundColor: 'var(--color-bg-card, white)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>Software Update</h2>
          {updateStatus === 'up-to-date' && !isOutdated && (
            <Chip color="success" variant="flat" size="sm" startContent={<HiOutlineCheckCircle className="w-4 h-4" />}>
              Up to date
            </Chip>
          )}
          {(updateStatus === 'available' || isOutdated) && (
            <Chip color="warning" variant="flat" size="sm" startContent={<HiOutlineArrowDownTray className="w-4 h-4" />}>
              Update available{updateVersion ? ` — v${updateVersion}` : latestVersion ? ` — v${latestVersion}` : ''}
            </Chip>
          )}
          {updateStatus === 'error' && (
            <Chip color="danger" variant="flat" size="sm" startContent={<HiOutlineExclamationTriangle className="w-4 h-4" />}>
              Error
            </Chip>
          )}
        </div>

        {/* Version comparison */}
        {currentVersion && latestVersion && (
          <div className="flex items-center gap-3 text-sm">
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>Installed: <strong>v{currentVersion}</strong></span>
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>•</span>
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>Latest: <strong style={{ color: isOutdated ? 'var(--color-warning-500, #f59e0b)' : 'var(--color-success-500, #22c55e)' }}>v{latestVersion}</strong></span>
          </div>
        )}

        {updateStatus === 'checking' && (
          <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
            <Spinner size="sm" />
            <span>Checking for updates...</span>
          </div>
        )}

        {updateStatus === 'up-to-date' && !isOutdated && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
            You are running the latest version of Talio Desktop.
          </p>
        )}

        {(updateStatus === 'available') && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
            A new version (v{updateVersion || latestVersion}) is being downloaded and will be installed automatically. The app will restart when ready.
          </p>
        )}

        {isOutdated && updateStatus !== 'available' && updateStatus !== 'checking' && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
            A newer version (v{latestVersion}) is available. Click the button below to check and install the update.
          </p>
        )}

        {updateStatus === 'error' && (
          <p className="text-sm text-danger-500">
            Update check failed: {updateError || 'Unknown error'}
          </p>
        )}

        {(!updateStatus || updateStatus === 'up-to-date' || updateStatus === 'error' || (isOutdated && updateStatus !== 'available')) && (
          <Button
            onPress={handleCheckUpdate}
            variant="flat"
            color={isOutdated ? 'warning' : 'primary'}
            startContent={<HiOutlineArrowPath className="w-4 h-4" />}
            isLoading={updateStatus === 'checking'}
            size="sm"
          >
            {isOutdated ? 'Update Now' : 'Check for Updates'}
          </Button>
        )}
      </div>

      {/* System Info */}
      <div className="rounded-2xl border p-5 space-y-1" style={{ borderColor: 'var(--color-primary-200)', backgroundColor: 'var(--color-bg-card, white)' }}>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>System Information</h2>
        {!appInfo ? (
          <div className="flex items-center gap-3 py-4">
            <Spinner size="sm" />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>Loading...</span>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-primary-100)' }}>
            {infoRows.map((row) => (
              <div key={row.label} className="flex items-start gap-3 py-3">
                <row.icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary-500)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>{row.label}</p>
                  <p className="text-sm font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>{row.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-xs" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
        © {new Date().getFullYear()} MW FutureTech Pvt. Ltd. All rights reserved.
      </p>
    </div>
  )
}
