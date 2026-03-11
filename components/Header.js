'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { FaSearch, FaTimes, FaSyncAlt } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import MiraSphere from '@/components/ui/MiraSphere'
import { handleSessionExpired } from '@/utils/userHelper'
import { useTheme } from '@/contexts/ThemeContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { useFocusTimer } from '@/contexts/FocusTimerContext'
import { Button, Input, ScrollShadow } from '@heroui/react'

export default function Header({ toggleSidebar, sidebarCollapsed }) {
  const { theme, isDarkMode } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const { openWidget } = useChatWidget()

  const [mounted, setMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [showMiraModal, setShowMiraModal] = useState(false)
  const [miraModalClosing, setMiraModalClosing] = useState(false)
  const [isMiraHovered, setIsMiraHovered] = useState(false)
  const searchRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  // Check if desktop for header left positioning
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Handle Escape key to close MIRA modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showMiraModal && !miraModalClosing) {
        setMiraModalClosing(true)
      }
    }

    if (showMiraModal) {
      window.addEventListener('keydown', handleEscape)
      return () => window.removeEventListener('keydown', handleEscape)
    }
  }, [showMiraModal, miraModalClosing])

  // Keyboard shortcut: Cmd/Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearchResults(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  // Search functionality
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchQuery.trim().length < 2) {
      setSearchResults(null)
      setShowSearchResults(false)
      return
    }

    setSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token')
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })

        // Handle 401 - session expired
        if (response.status === 401) {
          handleSessionExpired()
          return
        }

        const result = await response.json()
        if (result.success) {
          setSearchResults(result.data)
          setShowSearchResults(true)
        }
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  const handleSearchResultClick = (link) => {
    setShowSearchResults(false)
    setShowMobileSearch(false)
    setSearchQuery('')

    // On desktop, open chat popup instead of navigating to chat page
    if (link === '/dashboard/chat' && isDesktop) {
      openWidget('button')
      return
    }

    router.push(link)
  }

  const closeMobileSearch = () => {
    setShowMobileSearch(false)
    setSearchQuery('')
    setSearchResults(null)
    setShowSearchResults(false)
  }

  const getCategoryLabel = (category) => {
    const labels = {
      pages: 'Pages & Navigation',
      tasks: 'Tasks',
      leaves: 'Leaves',
      announcements: 'Announcements',
      policies: 'Policies'
    }
    return labels[category] || category.charAt(0).toUpperCase() + category.slice(1)
  }

  // Don't render user-specific content until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <header
        className="h-[60.5px] bg-content1 w-full z-[50] shadow-[0_2px_6px_rgba(15,23,42,0.08)] transition-all duration-300 flex-shrink-0"
      >
        <div className="flex items-center justify-between px-1 sm:px-4 lg:px-6 h-[60.5px] lg:h-[60px]">
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
      className="h-[60.5px] bg-content1 w-full z-[50] shadow-[0_2px_6px_rgba(15,23,42,0.08)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-all duration-300 flex-shrink-0"
    >
      <div className="flex items-center justify-between px-1 sm:px-4 lg:px-6 h-[60.5px] lg:h-[60px]">
        {/* Left side — Hamburger (mobile/tablet) + Search pill */}
        <div className="flex items-center space-x-2 sm:space-x-3 flex-1">
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

          {/* Search Pill Button — opens floating search overlay */}
          <div ref={searchRef}>
            <button
              onClick={() => {
                if (window.innerWidth < 768) {
                  setShowMobileSearch(true)
                } else {
                  setShowSearchResults(true)
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-default-200 dark:border-default-100 bg-default-50 dark:bg-default-100 hover:bg-default-100 dark:hover:bg-default-200 transition-all duration-200 cursor-pointer group"
            >
              <FaSearch className="w-3.5 h-3.5 text-default-400 group-hover:text-default-500 transition-colors" />
              <span className="text-sm text-default-400 group-hover:text-default-500 transition-colors hidden sm:inline">Search...</span>
              <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-default-200 dark:bg-default-50 text-[10px] text-default-500 font-mono">
                ⌘K
              </kbd>
            </button>

            {/* Floating Search Overlay (Desktop) */}
            {(showSearchResults || searchQuery.length >= 2) && (
              <>
                <div
                  className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[10px]"
                  onClick={() => {
                    setSearchQuery('')
                    setShowSearchResults(false)
                  }}
                />
                <div className="fixed left-1/2 -translate-x-1/2 top-4 w-[90%] max-w-xl bg-content1 rounded-xl shadow-2xl border border-divider overflow-hidden z-[101]">
                  <div className="relative flex items-center">
                    <Input
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                      placeholder="Search everything..."
                      startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                      endContent={
                        searching ? <Loader size="xs" /> :
                          searchQuery ? (
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setSearchQuery('')
                                setShowSearchResults(false)
                              }}
                            >
                              <FaTimes className="w-4 h-4" />
                            </Button>
                          ) : null
                      }
                      classNames={{
                        inputWrapper: 'bg-transparent border-b border-divider rounded-none'
                      }}
                      autoFocus
                    />
                  </div>

                  {/* Search Results */}
                  {showSearchResults && searchResults && (
                    <ScrollShadow className="max-h-[60vh]">
                      {Object.entries(searchResults).map(([category, items]) => {
                        if (items.length === 0) return null
                        return (
                          <div key={category} className="border-b border-divider last:border-b-0">
                            <div className="px-4 py-2 bg-default-50 font-semibold text-xs text-default-600 uppercase sticky top-0">
                              {getCategoryLabel(category)} <span className="text-default-400">({items.length})</span>
                            </div>
                            {items.map((item, index) => (
                              <div
                                key={item._id || index}
                                onClick={() => handleSearchResultClick(item.link)}
                                className="px-4 py-3 cursor-pointer transition-colors hover:bg-default-100"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <h4 className="font-medium text-sm text-default-900 truncate">{item.title}</h4>
                                    {item.meta && item.type !== 'page' && (
                                      <span className="text-xs text-default-500 bg-default-100 px-2 py-0.5 rounded">{item.meta}</span>
                                    )}
                                  </div>
                                  {item.subtitle && (
                                    <p className="text-xs text-default-500">{item.subtitle}</p>
                                  )}
                                  {item.description && (
                                    <p className="text-xs text-default-400 line-clamp-1 mt-0.5">{item.description}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                      {Object.values(searchResults).every(arr => arr.length === 0) && (
                        <div className="px-4 py-8 text-center text-default-500">
                          <p className="text-sm font-medium">No results found for &ldquo;{searchQuery}&rdquo;</p>
                          <p className="text-xs text-default-400 mt-1">Try different keywords</p>
                        </div>
                      )}
                    </ScrollShadow>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right side — MIRA + Focus Timer + Refresh */}
        <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
          {/* MIRA Cloud Button - Desktop Only */}
          <div
            className="hidden md:flex items-center justify-center cursor-pointer relative group"
            data-mira-sphere="true"
            onClick={() => setShowMiraModal(true)}
            onMouseEnter={() => setIsMiraHovered(true)}
            onMouseLeave={() => setIsMiraHovered(false)}
          >
            <MiraSphere size={55} isHovered={isMiraHovered} />
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-xs font-medium text-white bg-gray-900 dark:bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              MIRA Cloud
            </span>
          </div>

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

          {/* Mobile/Tablet Search Button */}
          <Button
            isIconOnly
            variant="light"
            className="lg:!hidden"
            onPress={() => setShowMobileSearch(true)}
          >
            <FaSearch className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Mobile Search Fullscreen Modal */}
      {showMobileSearch && (
        <div className="fixed inset-0 bg-content1 z-[100] lg:!hidden">
          <div className="flex flex-col h-full">
            {/* Search Header - Match header height */}
            <div className="flex items-center gap-3 px-3 h-16 border-b border-divider bg-content1">
              <Button
                isIconOnly
                variant="light"
                onPress={closeMobileSearch}
              >
                <FaTimes className="w-5 h-5" />
              </Button>
              <div className="flex-1">
                <Input
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search everything..."
                  startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                  endContent={
                    searching ? <Loader size="xs" /> :
                      searchQuery ? (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => {
                            setSearchQuery('')
                            setSearchResults(null)
                          }}
                        >
                          <FaTimes className="w-4 h-4" />
                        </Button>
                      ) : null
                  }
                  autoFocus
                />
              </div>
            </div>

            {/* Search Results */}
            <ScrollShadow className="flex-1">
              {searchQuery.length < 2 ? (
                <div className="flex flex-col items-center justify-center h-full text-default-400 px-4">
                  <FaSearch className="w-16 h-16 mb-4 text-default-300" />
                  <p className="text-lg font-medium">Search Everything</p>
                  <p className="text-sm text-center mt-2">
                    Find pages, tasks, leaves, announcements, and more...
                  </p>
                </div>
              ) : searching ? (
                <div className="flex items-center justify-center h-full">
                  <Loader size="md" />
                </div>
              ) : searchResults ? (
                <div>
                  {Object.entries(searchResults).map(([category, items]) => {
                    if (items.length === 0) return null
                    return (
                      <div key={category} className="border-b border-divider">
                        <div className="px-4 py-3 bg-default-100 dark:bg-default-50 font-semibold text-sm text-default-700 uppercase sticky top-0 z-10">
                          {getCategoryLabel(category)} <span className="text-default-500">({items.length})</span>
                        </div>
                        {items.map((item, index) => (
                          <div
                            key={item._id || index}
                            onClick={() => handleSearchResultClick(item.link)}
                            className="px-4 py-4 cursor-pointer border-b border-default-50 transition-colors hover:bg-default-100"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-base text-default-900">{item.title}</h4>
                              </div>
                              {item.subtitle && (
                                <p className="text-sm mb-1 text-primary-600">{item.subtitle}</p>
                              )}
                              {item.description && (
                                <p className="text-sm text-default-500 line-clamp-2">{item.description}</p>
                              )}
                              {item.meta && item.type !== 'page' && (
                                <span className="inline-block text-xs text-default-500 bg-default-100 px-2 py-1 rounded mt-2">
                                  {item.meta}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {Object.values(searchResults).every(arr => arr.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full text-default-400 px-4 py-12">
                      <FaSearch className="w-16 h-16 mb-4 text-default-300" />
                      <p className="text-lg font-medium">No results found</p>
                      <p className="text-sm text-center mt-2 text-default-500">
                        Try different keywords or check spelling
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </ScrollShadow>
          </div>
        </div>
      )}

      {/* MIRA Cloud Fullscreen Modal */}
      {/* Backdrop overlay with blur animation - renders below iframe */}
      {(showMiraModal || miraModalClosing) && (
        <div
          className={`fixed inset-0 bg-black/60 backdrop-blur-[10px] ${miraModalClosing ? 'animate-mira-backdrop-out' : 'animate-mira-backdrop-in'}`}
          style={{ zIndex: 99998, pointerEvents: 'none' }}
          onAnimationEnd={() => {
            if (miraModalClosing) {
              setMiraModalClosing(false)
              setShowMiraModal(false)
            }
          }}
        />
      )}

      {/* Iframe container - only mounted when modal is open */}
      {(showMiraModal || miraModalClosing) && (
        <div
          className={`fixed inset-0 ${miraModalClosing ? 'animate-mira-iframe-out' : 'animate-mira-iframe-in'}`}
          style={{
            zIndex: 99999,
            pointerEvents: 'auto'
          }}
        >
          <iframe
            src="https://itsmira.cloud"
            className="w-full h-full border-0"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            allow="microphone; camera; clipboard-read; clipboard-write"
            title="MIRA Cloud"
          />
        </div>
      )}

      {/* Close button - separate from backdrop for proper click handling */}
      {(showMiraModal || miraModalClosing) && (
        <Button
          isIconOnly
          variant="solid"
          className="fixed top-4 right-4 bg-default-900/80 hover:bg-default-900"
          style={{ zIndex: 100000 }}
          onPress={() => setMiraModalClosing(true)}
        >
          <FaTimes className="w-6 h-6 text-white" />
        </Button>
      )}
    </header>
  )
}

// Focus Timer Pill — persists in header when timer is active
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
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" className="text-gray-200 dark:text-slate-700" strokeWidth="2.5" />
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
