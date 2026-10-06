'use client'
import HeaderSearch from '@/components/HeaderSearch'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { FaSyncAlt } from 'react-icons/fa'
import MiraSphere from '@/components/ui/MiraPet'
import MiraWakeReminder from '@/components/MiraWakeReminder'
import { useTheme } from '@/contexts/ThemeContext'
import { useFocusTimer } from '@/contexts/FocusTimerContext'
import { useMiraChat } from '@/contexts/MiraChatContext'
import { Button } from '@heroui/react'

export default function Header({ toggleSidebar, sidebarCollapsed }) {
  const { theme, isDarkMode, setDarkModePreference } = useTheme()

  const [mounted, setMounted] = useState(false)
  const [isMiraHovered, setIsMiraHovered] = useState(false)
  const { openChat, isOpen: isMiraOpen, isThinking } = useMiraChat()

  useEffect(() => {
    setMounted(true)
  }, [])
  // Don't render user-specific content until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <header
        className="talio-navigation-header w-full z-[40] transition-all duration-300 flex-shrink-0"
      >
        <div className="talio-navigation-header-row flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <Button
              isIconOnly
              variant="light"
              onPress={toggleSidebar}
              className="lg:!hidden"
            >
              <img
                src="/hamburger.png"
                alt="Menu"
                className="w-5 h-5"
                style={{ filter: 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
              />
            </Button>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header
      className="talio-navigation-header w-full z-[40] transition-all duration-300 flex-shrink-0"
    >
      <div className="talio-navigation-header-row flex items-center justify-between">
        {/* Left side - Hamburger (mobile/tablet) + Search pill */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <Button
            isIconOnly
            variant="light"
            onPress={toggleSidebar}
            className="lg:!hidden"
          >
            <img
              src="/hamburger.png"
              alt="Menu"
              className="w-5 h-5"
              style={{ filter: isDarkMode ? 'brightness(0) saturate(100%) invert(70%) sepia(8%) saturate(400%) hue-rotate(180deg)' : 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
            />
          </Button>

          {/* MIRA Cloud Pill Button - Desktop Only */}
          <div className="relative hidden md:block">
          <button
            type="button"
            aria-label={isMiraOpen ? 'Return to MIRA conversation' : 'Ask Mira'}
            aria-expanded={isMiraOpen}
            className="mira-header-pill hidden md:flex items-center cursor-pointer relative group"
            data-mira-sphere="true"
            onClick={() => openChat()}
            onMouseEnter={() => setIsMiraHovered(true)}
            onMouseLeave={() => setIsMiraHovered(false)}
            style={{
              background: `linear-gradient(135deg, ${theme.primary[600]}, ${theme.primary[400]}, ${theme.primary[700]}, ${theme.primary[500]})`,
              backgroundSize: '300% 300%',
              animation: 'mira-gradient-shift 6s ease infinite',
              borderRadius: 'var(--dashboard-header-control-radius)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Grain texture overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                opacity: 0.12,
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                backgroundSize: '128px 128px',
                pointerEvents: 'none',
              }}
            />
            {/* White circular background behind globe */}
            <div aria-hidden="true" className="mira-header-avatar relative z-10 flex items-center justify-center rounded-full bg-white dark:bg-white/90">
              <MiraSphere size={32} isThinking={isThinking} />
            </div>
            <span className="mira-header-label text-sm font-semibold whitespace-nowrap relative z-10" style={{ color: '#111111' }}>
              {isMiraOpen ? (isThinking ? 'On it…' : 'Mira is here') : 'Ask Mira'}
            </span>
            {isMiraOpen && <span aria-hidden="true" className={`relative z-10 ml-2 h-1.5 w-1.5 rounded-full bg-emerald-700 ${isThinking ? 'motion-safe:animate-pulse' : ''}`} />}
          </button>

          {/* Separator */}
          <MiraWakeReminder />
          </div>
          <div className="hidden md:block w-px h-7 bg-slate-400 dark:bg-zinc-300/40 mx-1" />

          <HeaderSearch />
        </div>

        {/* Global actions: focus timer and refresh */}
        <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
          {/* Focus Timer Pill */}
          <FocusTimerPill />

          {/* Refresh Button - Desktop Only */}
          <Button
            isIconOnly
            variant="light"
            className="hidden md:flex group"
            onPress={() => window.location.reload()}
          >
            <FaSyncAlt className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
          </Button>


        </div>
      </div>

    </header>
  )
}

// Focus Timer Pill - persists in header when timer is active
function FocusTimerPill() {
  const { running, done, mins, secs, pct, toggle, reset } = useFocusTimer()
  const pathname = usePathname()

  // Only show pill when not on dashboard (where the full card is visible) AND timer is active
  const onDashboard = pathname === '/dashboard'
  const active = running || done
  if (!active || onDashboard) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/50 shadow-sm animate-in fade-in slide-in-from-right-2 duration-300">
      {/* Progress ring */}
      <div className="relative w-6 h-6 flex-shrink-0">
        <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" className="text-gray-200 dark:text-zinc-700" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="10" fill="none" stroke={done ? '#10B981' : '#6366F1'} strokeWidth="2.5" strokeDasharray={`${2 * Math.PI * 10}`} strokeDashoffset={`${2 * Math.PI * 10 * (1 - pct / 100)}`} strokeLinecap="round" className="transition-all duration-1000" />
        </svg>
      </div>

      {/* Time */}
      <span className={`text-xs font-bold tabular-nums ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
        {done ? 'Done!' : `${mins}:${secs}`}
      </span>

      {/* Play/Pause */}
      <button
        onClick={toggle}
        className="p-0.5 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
        title={done ? 'Restart' : running ? 'Pause' : 'Resume'}
      >
        {done ? (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
        ) : running ? (
          <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>
        )}
      </button>

      {/* Reset */}
      {!done && (
        <button
          onClick={reset}
          className="p-0.5 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
          title="Reset"
        >
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  )
}

// Real-time Clock Component
function RealTimeClock({ timezone = 'Asia/Kolkata' }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: timezone
    })
  }

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone
    })
  }

  return (
    <div className="flex flex-col items-center">
      <div className="text-sm font-semibold text-default-900">
        {formatTime(time)}
      </div>
      <div className="text-xs text-default-500">
        {formatDate(time)}
      </div>
    </div>
  )
}
