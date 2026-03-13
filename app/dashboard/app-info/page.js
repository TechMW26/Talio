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
  HiOutlineSignal,
  HiOutlineHashtag,
  HiOutlineCube,
} from 'react-icons/hi2'

/* ── Shared glass-card wrapper ── */
function GlassCard({ children, className = '', style = {} }) {
  return (
    <div
      className={`relative overflow-hidden rounded-[32px] transition-all duration-500 group ${className}`}
      style={{
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        background: 'rgba(5,5,5,0.5)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        ...style,
      }}
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(to bottom right, rgba(255,255,255,0.05), transparent, rgba(0,0,0,0.2))',
      }} />
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
      className="group/pill flex items-center justify-between w-full p-4 rounded-2xl text-left relative overflow-hidden transition-all duration-300"
      style={{
        background: 'rgba(5,5,5,0.5)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="absolute inset-0 opacity-0 group-hover/pill:opacity-100 transition-opacity duration-300"
        style={{ background: 'linear-gradient(to right, rgba(125,187,174,0.1), transparent)' }} />
      <div className="flex items-center gap-4 relative z-10 min-w-0">
        <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center transition-all duration-300 group-hover/pill:scale-110"
          style={{ background: 'rgba(125,187,174,0.1)', border: '1px solid rgba(125,187,174,0.2)', color: '#7DBBAE' }}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-wider block">{label}</span>
          <span className="text-[14px] font-extrabold text-white block mt-0.5 truncate">{value}</span>
        </div>
      </div>
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center relative z-10 transition-all duration-300 ml-2"
        style={{
          background: copied ? 'rgba(52,199,89,0.2)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${copied ? 'rgba(52,199,89,0.4)' : 'rgba(255,255,255,0.1)'}`,
        }}>
        {copied
          ? <HiOutlineCheck className="w-3.5 h-3.5 text-green-400" />
          : <HiOutlineClipboardDocument className="w-3.5 h-3.5 text-slate-400 group-hover/pill:text-white transition-colors" />}
      </div>
    </button>
  )
}

/* ── Infrastructure detail item ── */
function DetailItem({ icon: Icon, label, value, colorClass }) {
  const colorMap = {
    blue:   { bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)',  icon: '#60a5fa' },
    indigo: { bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.2)',  icon: '#818cf8' },
    sky:    { bg: 'rgba(14,165,233,0.1)',  border: 'rgba(14,165,233,0.2)',  icon: '#38bdf8' },
    teal:   { bg: 'rgba(125,187,174,0.1)', border: 'rgba(125,187,174,0.2)', icon: '#7DBBAE' },
  }
  const c = colorMap[colorClass] || colorMap.teal
  return (
    <div
      className="p-4 rounded-2xl cursor-default transition-all duration-300 hover:translate-y-[-2px]"
      style={{ background: c.bg, border: `1px solid ${c.border}`, backdropFilter: 'blur(4px)' }}
    >
      <Icon className="w-[18px] h-[18px] mb-3 transition-transform duration-300" style={{ color: c.icon }} />
      <span className="font-mono text-[10px] text-slate-500 font-bold tracking-wider uppercase block">{label}</span>
      <span className="text-[14px] font-extrabold text-white block mt-0.5">{value}</span>
    </div>
  )
}

/* ── Live clock ── */
function LiveClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour12: true }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 rounded-full"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
      <HiOutlineClock className="w-3.5 h-3.5 text-slate-400" />
      <span className="font-mono text-xs font-semibold text-slate-400">{time || '--:--:-- --'}</span>
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
    <div className="relative min-h-[calc(100vh-120px)] overflow-hidden rounded-3xl" style={{ background: '#050505' }}>
      {/* Background gradient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(125,187,174,0.15) 0%, transparent 70%)' }} />
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />

      <div className="relative z-10 max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-10 py-8">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between mb-10 animate-[fadeInDown_0.6s_ease_both]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
              <img src="/assets/lanyard-card-logo.webp" alt="Talio" className="w-6 h-6 object-contain" />
            </div>
            <span className="text-xl font-extrabold text-white tracking-tight">Talio.</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 px-4 py-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[13px] font-bold text-slate-400">Desktop Active</span>
            </div>
            <LiveClock />
          </div>
        </div>

        {/* ── Hero ── */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 animate-[fadeInScale_0.5s_0.1s_ease_both]"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold"
              style={{ background: isOutdated ? 'rgba(245,158,11,0.2)' : 'rgba(125,187,174,0.2)', color: isOutdated ? '#F59E0B' : '#7DBBAE' }}>
              {isOutdated ? 'UPDATE' : 'LATEST'}
            </span>
            <span className="text-[13px] font-semibold text-slate-400">
              Talio Desktop {currentVersion ? `v${currentVersion}` : ''}
            </span>
          </div>
          <h1 className="text-[clamp(40px,5vw,64px)] font-extrabold tracking-tighter text-white leading-[1.05] animate-[fadeInUp_0.6s_0.2s_ease_both] opacity-0 [animation-fill-mode:forwards]">
            System{' '}
            <span style={{
              background: 'linear-gradient(to right, #7DBBAE, #E2F0ED)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>Information.</span>
          </h1>
          <p className="mt-6 text-lg font-medium text-slate-400 animate-[fadeInUp_0.6s_0.3s_ease_both] opacity-0 [animation-fill-mode:forwards]">
            Complete overview of your desktop environment and update status.
          </p>
        </div>

        {/* ── Info Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-12">

          {/* ── System Details (5 cols) ── */}
          <GlassCard className="md:col-span-5 animate-[fadeInUp_0.8s_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-extrabold text-white tracking-tight">System Details</h3>
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <HiOutlineComputerDesktop className="w-3.5 h-3.5 text-slate-300" />
                </div>
              </div>

              {!appInfo ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <Spinner size="sm" color="white" />
                  <span className="text-sm text-slate-500">Loading...</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem
                    icon={HiOutlineComputerDesktop}
                    label="Platform"
                    value={platformLabel[appInfo.platform] || appInfo.platform || 'Unknown'}
                    colorClass="blue"
                  />
                  <DetailItem
                    icon={HiOutlineCpuChip}
                    label="Architecture"
                    value={archLabel[appInfo.arch] || appInfo.arch || 'Unknown'}
                    colorClass="indigo"
                  />
                  <DetailItem
                    icon={HiOutlineHashtag}
                    label="Version"
                    value={`v${appInfo.version}`}
                    colorClass="sky"
                  />
                  <DetailItem
                    icon={HiOutlineShieldCheck}
                    label="Status"
                    value={appInfo.isPackaged ? 'Production' : 'Development'}
                    colorClass="teal"
                  />
                </div>
              )}
            </div>
          </GlassCard>

          {/* ── Software Update (4 cols) ── */}
          <GlassCard className="md:col-span-4 animate-[fadeInUp_0.8s_0.5s_cubic-bezier(0.16,1,0.3,1)_both]">
            <div className="p-8 flex flex-col justify-between h-full">
              {/* Glow effect on hover */}
              <div className="absolute top-0 right-0 w-48 h-48 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                style={{ background: 'rgba(16,185,129,0.2)', filter: 'blur(48px)' }} />

              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <HiOutlineArrowDownTray className="w-[18px] h-[18px] text-emerald-400" />
                  <span className="text-lg font-extrabold text-white tracking-tight">Software Update</span>
                </div>

                {/* Update health display */}
                {isUpToDate && (
                  <>
                    <span className="text-4xl font-extrabold text-white tracking-tighter leading-none block mt-4">
                      Up to date
                    </span>
                    <span className="inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-bold text-emerald-400"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      v{currentVersion}
                    </span>
                  </>
                )}

                {updateStatus === 'checking' && (
                  <div className="flex items-center gap-3 mt-6">
                    <Spinner size="sm" color="white" />
                    <span className="text-sm text-slate-400">Checking for updates...</span>
                  </div>
                )}

                {(updateStatus === 'available' || (isOutdated && !updateStatus)) && (
                  <>
                    <span className="text-4xl font-extrabold text-white tracking-tighter leading-none block mt-4">
                      v{updateVersion || latestVersion}
                    </span>
                    <span className="inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-bold text-amber-400"
                      style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                      Update Available
                    </span>
                  </>
                )}

                {updateStatus === 'downloaded' && (
                  <>
                    <span className="text-4xl font-extrabold text-white tracking-tighter leading-none block mt-4">
                      Ready
                    </span>
                    <span className="inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-bold text-emerald-400"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      v{updateVersion || latestVersion} downloaded
                    </span>
                  </>
                )}

                {updateStatus === 'installing' && (
                  <div className="flex items-center gap-3 mt-6">
                    <Spinner size="sm" color="white" />
                    <span className="text-sm text-slate-400">Installing and restarting...</span>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <>
                    <span className="text-4xl font-extrabold text-red-400 tracking-tighter leading-none block mt-4">
                      Error
                    </span>
                    <p className="text-xs text-red-400/80 mt-2">{updateError || 'Update check failed'}</p>
                  </>
                )}

                {!updateStatus && !isOutdated && (
                  <>
                    <span className="text-4xl font-extrabold text-white tracking-tighter leading-none block mt-4">
                      {currentVersion ? `v${currentVersion}` : '...'}
                    </span>
                    <span className="inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-bold text-slate-400"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      Tap to check
                    </span>
                  </>
                )}
              </div>

              {/* Progress bars (shown during download or as version comparison) */}
              <div className="relative z-10 mt-8 space-y-4">
                {updateStatus === 'downloading' ? (
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-[13px] font-bold text-slate-400">Downloading{updateVersion ? ` v${updateVersion}` : ''}</span>
                      <span className="font-mono text-[11px] font-bold text-slate-500">{Math.round(downloadPercent)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300 relative overflow-hidden"
                        style={{ width: `${downloadPercent}%`, background: '#7DBBAE' }}
                      >
                        <div className="absolute top-0 bottom-0 w-16 animate-[shimmer_3s_linear_infinite]"
                          style={{ background: 'rgba(255,255,255,0.3)', transform: 'skewX(12deg)', filter: 'blur(2px)' }} />
                      </div>
                    </div>
                  </div>
                ) : currentVersion && latestVersion ? (
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-[13px] font-bold text-slate-400">Installed</span>
                      <span className="font-mono text-[11px] font-bold text-slate-500">v{currentVersion}</span>
                    </div>
                    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div className="h-full rounded-full relative overflow-hidden"
                        style={{ width: isOutdated ? '85%' : '100%', background: isOutdated ? '#F59E0B' : '#7DBBAE' }}>
                        <div className="absolute top-0 bottom-0 w-16 animate-[shimmer_3s_2s_linear_infinite]"
                          style={{ background: 'rgba(255,255,255,0.3)', transform: 'skewX(12deg)', filter: 'blur(2px)' }} />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Action buttons */}
                {updateStatus === 'downloaded' && (
                  <Button
                    onPress={handleInstallUpdate}
                    className="w-full mt-2 font-bold"
                    style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', color: '#34D399' }}
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
                    className="w-full mt-2 font-bold"
                    style={{
                      background: isOutdated ? 'rgba(245,158,11,0.15)' : 'rgba(125,187,174,0.15)',
                      border: `1px solid ${isOutdated ? 'rgba(245,158,11,0.3)' : 'rgba(125,187,174,0.3)'}`,
                      color: isOutdated ? '#F59E0B' : '#7DBBAE',
                    }}
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
          <div className="md:col-span-3 flex flex-col gap-4">
            <div className="animate-[fadeInUp_0.5s_0.6s_ease_both] opacity-0 [animation-fill-mode:forwards]">
              <CopyPill
                icon={HiOutlineHashtag}
                label="Current Version"
                value={currentVersion ? `v${currentVersion}` : '...'}
              />
            </div>
            <div className="animate-[fadeInUp_0.5s_0.7s_ease_both] opacity-0 [animation-fill-mode:forwards]">
              <CopyPill
                icon={HiOutlineFolder}
                label="User Data"
                value={appInfo?.userDataPath || '...'}
              />
            </div>

            {/* App size / path card */}
            <div className="flex-1 rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 animate-[fadeInUp_0.8s_0.8s_cubic-bezier(0.16,1,0.3,1)_both]"
              style={{
                background: 'rgba(5,5,5,0.5)',
                border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(24px)',
                minHeight: '120px',
              }}
            >
              <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: 'linear-gradient(to top, rgba(125,187,174,0.15), transparent)' }} />
              <div className="relative z-10 text-center">
                <span className="font-mono text-[10px] text-slate-500 font-bold tracking-wider uppercase block mb-2">Latest Available</span>
                <div className="flex items-baseline justify-center gap-1">
                  <strong className="text-3xl font-extrabold text-white tracking-tighter leading-none">
                    {latestVersion ? `v${latestVersion}` : '...'}
                  </strong>
                </div>
                {isOutdated && (
                  <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold text-amber-400"
                    style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    Newer version available
                  </span>
                )}
                {!isOutdated && currentVersion && latestVersion && (
                  <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    You&apos;re on the latest
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <p className="text-center text-xs text-slate-600 pb-4">
          © {new Date().getFullYear()} MW FutureTech Pvt. Ltd. All rights reserved.
        </p>
      </div>
    </div>
  )
}
