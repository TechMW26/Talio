'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button, Spinner } from '@heroui/react'
import {
  HiOutlineComputerDesktop,
  HiOutlineArrowPath,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineArrowDownTray,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineCpuChip,
  HiOutlineFolder,
  HiOutlineInformationCircle,
  HiOutlineClipboardDocument,
  HiOutlineCheck,
  HiOutlineShieldCheck,
  HiOutlineClock,
  HiOutlineHashtag,
} from 'react-icons/hi2'

/* ── Shared glass-card wrapper ── */
function GlassCard({ children, className = '' }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl transition-all duration-500 group ${className}`}
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border, rgba(0,0,0,0.08))',
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}

/* ── Copyable pill ── */
function CopyPill({ label, value, icon: Icon }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="group/pill flex items-center justify-between w-full p-3.5 rounded-xl text-left relative overflow-hidden transition-all duration-300"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border, rgba(0,0,0,0.08))',
      }}
    >
      <div className="absolute inset-0 opacity-0 group-hover/pill:opacity-100 transition-opacity duration-300"
        style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--color-primary-500) 8%, transparent), transparent)' }} />
      <div className="flex items-center gap-3 relative z-10 min-w-0">
        <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center transition-all duration-300 group-hover/pill:scale-110"
          style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-500)' }}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
          <span className="text-[13px] font-bold block mt-0.5 truncate" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
        </div>
      </div>
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center relative z-10 transition-all duration-300 ml-2"
        style={{
          background: copied ? 'rgba(16,185,129,0.1)' : 'var(--color-primary-50)',
          border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'var(--color-border, rgba(0,0,0,0.08))'}`,
        }}>
        {copied
          ? <HiOutlineCheck className="w-3 h-3 text-emerald-500" />
          : <HiOutlineClipboardDocument className="w-3 h-3" style={{ color: 'var(--color-text-secondary)' }} />}
      </div>
    </button>
  )
}

/* ── Detail item ── */
function DetailItem({ icon: Icon, label, value, colorClass }) {
  const colorMap = {
    blue:   { bg: 'var(--color-primary-50)',  icon: 'var(--color-primary-500)' },
    indigo: { bg: 'color-mix(in srgb, var(--color-primary-500) 10%, var(--color-bg-card))', icon: 'var(--color-primary-600)' },
    sky:    { bg: 'color-mix(in srgb, var(--color-primary-400) 12%, var(--color-bg-card))', icon: 'var(--color-primary-400)' },
    teal:   { bg: 'color-mix(in srgb, var(--color-primary-500) 8%, var(--color-bg-card))',  icon: 'var(--color-primary-700)' },
  }
  const c = colorMap[colorClass] || colorMap.blue
  return (
    <div
      className="p-3.5 rounded-xl cursor-default transition-all duration-300 hover:translate-y-[-2px]"
      style={{ background: c.bg, border: '1px solid var(--color-border, rgba(0,0,0,0.06))' }}
    >
      <Icon className="w-4 h-4 mb-2 transition-transform duration-300" style={{ color: c.icon }} />
      <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span className="text-[13px] font-bold block mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  )
}

/* ── Main page ── */
export default function AppInfoPage() {
  const [appInfo, setAppInfo] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [latestVersion, setLatestVersion] = useState(null)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [updateVersion, setUpdateVersion] = useState(null)
  const [updateError, setUpdateError] = useState(null)
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    const hasElectron = typeof window !== 'undefined' && (window.electronAPI !== undefined || window.isElectron === true)
    setIsElectron(hasElectron)

    if (hasElectron && window.electronAPI) {
      if (window.electronAPI.getAppInfo) {
        window.electronAPI.getAppInfo().then(info => {
          setAppInfo(info)
          setCurrentVersion(info.version)
        }).catch(() => {
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

      if (window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
          setUpdateStatus(data.status)
          if (data.version) setUpdateVersion(data.version)
          if (data.message) setUpdateError(data.message)
          if (data.status === 'downloading' && typeof data.percent === 'number') {
            setDownloadPercent(data.percent)
          }
        })
      }
    }

    fetch('/api/desktop/min-version')
      .then(res => res.json())
      .then(data => { if (data.latestVersion) setLatestVersion(data.latestVersion) })
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
      setDownloadPercent(0)
      window.electronAPI.checkForUpdate({ silent: true })
    } else if (window.electronAPI?.startUpdate) {
      setUpdateStatus('checking')
      window.electronAPI.startUpdate()
    }
  }, [])

  const handleInstallUpdate = useCallback(() => {
    if (window.electronAPI?.installUpdate) {
      setUpdateStatus('installing')
      window.electronAPI.installUpdate()
    }
  }, [])

  /* ── Not desktop ── */
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

  const platformLabel = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  const archLabel = { arm64: 'Apple Silicon (ARM64)', x64: 'Intel (x64)', ia32: 'x86 (32-bit)' }
  const isOutdated = currentVersion && latestVersion && currentVersion !== latestVersion
  const isUpToDate = updateStatus === 'up-to-date' && !isOutdated

  return (
    <div className="h-[calc(100vh-120px)] overflow-hidden flex flex-col items-center justify-center px-4 sm:px-6 lg:px-10">

      {/* ── Hero ── */}
      <div className="text-center max-w-2xl mx-auto mb-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-6 animate-[fadeInScale_0.5s_0.1s_ease_both]"
          style={{ background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)' }}>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold"
            style={{ background: isOutdated ? 'rgba(245,158,11,0.15)' : 'var(--color-primary-100)', color: isOutdated ? '#F59E0B' : 'var(--color-primary-600)' }}>
            {isOutdated ? 'UPDATE' : 'LATEST'}
          </span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Talio Desktop {currentVersion ? `v${currentVersion}` : ''}
          </span>
        </div>
        <h1 className="text-[clamp(32px,4vw,48px)] font-extrabold tracking-tighter leading-[1.1] animate-[fadeInUp_0.6s_0.2s_ease_both] opacity-0 [animation-fill-mode:forwards]" style={{ color: 'var(--color-text-primary)' }}>
          System{' '}
          <span style={{
            background: 'linear-gradient(to right, var(--color-primary-500), var(--color-primary-300))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>Information.</span>
        </h1>
        <p className="mt-3 text-sm font-medium animate-[fadeInUp_0.6s_0.3s_ease_both] opacity-0 [animation-fill-mode:forwards]" style={{ color: 'var(--color-text-secondary)' }}>
          Complete overview of your desktop environment and update status.
        </p>
      </div>

      {/* ── Info Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 w-full max-w-[1100px]">

        {/* ── System Details (5 cols) ── */}
        <GlassCard className="md:col-span-5 animate-[fadeInUp_0.8s_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>System Details</h3>
              <div className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: 'var(--color-primary-50)' }}>
                <HiOutlineComputerDesktop className="w-3.5 h-3.5" style={{ color: 'var(--color-primary-500)' }} />
              </div>
            </div>

            {!appInfo ? (
              <div className="flex items-center justify-center py-8 gap-3">
                <Spinner size="sm" />
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <DetailItem icon={HiOutlineComputerDesktop} label="Platform" value={platformLabel[appInfo.platform] || appInfo.platform || 'Unknown'} colorClass="blue" />
                <DetailItem icon={HiOutlineCpuChip} label="Architecture" value={archLabel[appInfo.arch] || appInfo.arch || 'Unknown'} colorClass="indigo" />
                <DetailItem icon={HiOutlineHashtag} label="Version" value={`v${appInfo.version}`} colorClass="sky" />
                <DetailItem icon={HiOutlineShieldCheck} label="Status" value={appInfo.isPackaged ? 'Production' : 'Development'} colorClass="teal" />
              </div>
            )}
          </div>
        </GlassCard>

        {/* ── Software Update (4 cols) ── */}
        <GlassCard className="md:col-span-4 animate-[fadeInUp_0.8s_0.5s_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="p-5 flex flex-col justify-between h-full">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1.5">
                <HiOutlineArrowDownTray className="w-4 h-4" style={{ color: 'var(--color-primary-500)' }} />
                <span className="text-base font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>Software Update</span>
              </div>

              {isUpToDate && (
                <>
                  <span className="text-3xl font-extrabold tracking-tighter leading-none block mt-3" style={{ color: 'var(--color-text-primary)' }}>Up to date</span>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-md text-[11px] font-bold text-emerald-600 dark:text-emerald-400"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    v{currentVersion}
                  </span>
                </>
              )}

              {updateStatus === 'checking' && (
                <div className="flex items-center gap-3 mt-4">
                  <Spinner size="sm" />
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Checking for updates...</span>
                </div>
              )}

              {(updateStatus === 'available' || (isOutdated && !updateStatus)) && (
                <>
                  <span className="text-3xl font-extrabold tracking-tighter leading-none block mt-3" style={{ color: 'var(--color-text-primary)' }}>v{updateVersion || latestVersion}</span>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-md text-[11px] font-bold text-amber-600 dark:text-amber-400"
                    style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    Update Available
                  </span>
                </>
              )}

              {updateStatus === 'downloaded' && (
                <>
                  <span className="text-3xl font-extrabold tracking-tighter leading-none block mt-3" style={{ color: 'var(--color-text-primary)' }}>Ready</span>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-md text-[11px] font-bold text-emerald-600 dark:text-emerald-400"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    v{updateVersion || latestVersion} downloaded
                  </span>
                </>
              )}

              {updateStatus === 'installing' && (
                <div className="flex items-center gap-3 mt-4">
                  <Spinner size="sm" />
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Installing and restarting...</span>
                </div>
              )}

              {updateStatus === 'error' && (
                <>
                  <span className="text-3xl font-extrabold tracking-tighter leading-none block mt-3 text-red-500">Error</span>
                  <p className="text-xs text-red-500/80 mt-1">{updateError || 'Update check failed'}</p>
                </>
              )}

              {!updateStatus && !isOutdated && (
                <>
                  <span className="text-3xl font-extrabold tracking-tighter leading-none block mt-3" style={{ color: 'var(--color-text-primary)' }}>
                    {currentVersion ? `v${currentVersion}` : '...'}
                  </span>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)' }}>
                    Tap to check
                  </span>
                </>
              )}
            </div>

            {/* Progress bar (only during download) */}
            <div className="relative z-10 mt-6 space-y-3">
              {updateStatus === 'downloading' && (
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Downloading{updateVersion ? ` v${updateVersion}` : ''}</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{Math.round(downloadPercent)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-primary-100)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300 relative overflow-hidden"
                      style={{ width: `${downloadPercent}%`, background: 'var(--color-primary-500)' }}
                    >
                      <div className="absolute top-0 bottom-0 w-16 animate-[shimmer_3s_linear_infinite]"
                        style={{ background: 'rgba(255,255,255,0.4)', transform: 'skewX(12deg)', filter: 'blur(2px)' }} />
                    </div>
                  </div>
                </div>
              )}

              {updateStatus === 'downloaded' && (
                <Button
                  onPress={handleInstallUpdate}
                  className="w-full font-bold"
                  color="success"
                  variant="flat"
                  startContent={<HiOutlineArrowPathRoundedSquare className="w-4 h-4" />}
                  size="sm"
                  radius="lg"
                >
                  Restart &amp; Update
                </Button>
              )}
              {(!updateStatus || updateStatus === 'up-to-date' || updateStatus === 'error' || (isOutdated && updateStatus !== 'available' && updateStatus !== 'downloading' && updateStatus !== 'downloaded' && updateStatus !== 'checking')) && (
                <Button
                  onPress={handleCheckUpdate}
                  className="w-full font-bold"
                  color={isOutdated ? 'warning' : 'primary'}
                  variant="flat"
                  startContent={<HiOutlineArrowPath className="w-4 h-4" />}
                  isLoading={updateStatus === 'checking'}
                  size="sm"
                  radius="lg"
                >
                  {isOutdated ? 'Update Now' : 'Check for Updates'}
                </Button>
              )}
            </div>
          </div>
        </GlassCard>

        {/* ── Right Column (3 cols) ── */}
        <div className="md:col-span-3 flex flex-col gap-3">
          <div className="animate-[fadeInUp_0.5s_0.6s_ease_both] opacity-0 [animation-fill-mode:forwards]">
            <CopyPill icon={HiOutlineHashtag} label="Current Version" value={currentVersion ? `v${currentVersion}` : '...'} />
          </div>
          <div className="animate-[fadeInUp_0.5s_0.7s_ease_both] opacity-0 [animation-fill-mode:forwards]">
            <CopyPill icon={HiOutlineFolder} label="User Data" value={appInfo?.userDataPath || '...'} />
          </div>

          {/* Latest version card */}
          <div className="flex-1 rounded-xl p-5 flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 animate-[fadeInUp_0.8s_0.8s_cubic-bezier(0.16,1,0.3,1)_both]"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border, rgba(0,0,0,0.08))',
              minHeight: '100px',
            }}
          >
            <div className="relative z-10 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Latest Available</span>
              <strong className="text-2xl font-extrabold tracking-tighter leading-none" style={{ color: 'var(--color-text-primary)' }}>
                {latestVersion ? `v${latestVersion}` : '...'}
              </strong>
              {isOutdated && (
                <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold text-amber-600 dark:text-amber-400"
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  Newer version available
                </span>
              )}
              {!isOutdated && currentVersion && latestVersion && (
                <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  You&apos;re on the latest
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-xs mt-6" style={{ color: 'var(--color-text-secondary)' }}>
        © {new Date().getFullYear()} MW FutureTech Pvt. Ltd. All rights reserved.
      </p>
    </div>
  )
}
