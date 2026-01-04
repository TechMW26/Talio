'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { FaBars, FaBell, FaUser, FaSignOutAlt, FaCog, FaSearch, FaComments, FaTimes, FaSpinner } from 'react-icons/fa'
import toast from '@/utils/toast'
import { useTheme } from '@/contexts/ThemeContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import UnreadBadge from '@/components/UnreadBadge'
import { formatDesignation as formatDesignationLib, formatDepartments, getLevelNameFromNumber } from '@/lib/formatters'

export default function Header({ toggleSidebar, sidebarCollapsed }) {
  const { theme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const { unreadCount } = useUnreadMessages()
  const { openWidget } = useChatWidget()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[600] || '#2563EB'
  const primaryLight = theme?.primary?.[50] || '#EFF6FF'
  const primaryMedium = theme?.primary?.[500] || '#3B82F6'

  const [user, setUser] = useState(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [pageTitle, setPageTitle] = useState('HOME')
  const [employeeData, setEmployeeData] = useState(null)
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [isDesktop, setIsDesktop] = useState(false)
  const [showMiraModal, setShowMiraModal] = useState(false)
  const notifRef = useRef(null)
  const profileRef = useRef(null)
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

  // Get user initials for avatar fallback
  const getUserInitials = () => {
    const firstName = employeeData?.firstName || user?.firstName || ''
    const lastName = employeeData?.lastName || user?.lastName || ''
    if (firstName || lastName) {
      return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()
    }
    // Fallback to email first letter
    const email = user?.email || ''
    return email[0]?.toUpperCase() || 'U'
  }

  useEffect(() => {
    setMounted(true)
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // If user already has complete employee data from login, use it
      if (parsedUser.firstName && parsedUser.designation) {
        setEmployeeData({
          firstName: parsedUser.firstName,
          lastName: parsedUser.lastName,
          profilePicture: parsedUser.profilePicture,
          designation: parsedUser.designation,
          department: parsedUser.department,
          employeeNumber: parsedUser.employeeNumber,
        })
      }

      // Always fetch fresh employee data to ensure it's up to date
      // Handle both string ID and object with _id
      const empId = parsedUser.employeeId
        ? (typeof parsedUser.employeeId === 'object'
          ? (parsedUser.employeeId._id || parsedUser.employeeId)
          : parsedUser.employeeId)
        : null

      if (empId) {
        fetchEmployeeData(empId)
      }
    }
  }, [])

  // Helper function to format designation with level name
  // Uses employee data if available for accurate level info
  const formatDesignation = (designation, employee = null) => {
    return formatDesignationLib(designation, employee)
  }

  // Get level name from level number (kept for backward compatibility)
  const getLevelNameFromNumber2 = getLevelNameFromNumber

  const fetchEmployeeData = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const result = await response.json()
      if (result.success) {
        console.log('Employee Data Fetched:', result.data)
        console.log('Designation Object:', result.data.designation)
        console.log('Designation Title:', result.data.designation?.title)
        console.log('Designation Level Name:', result.data.designation?.levelName)
        console.log('Employee Designation Level:', result.data.designationLevel)
        console.log('Employee Designation Level Name:', result.data.designationLevelName)
        setEmployeeData(result.data)
        
        if (result.data.company && result.data.company.timezone) {
          setTimezone(result.data.company.timezone)
        }

        // Sync user data in localStorage with employee data (including new fields)
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
        const syncedUser = {
          ...currentUser,
          firstName: result.data.firstName,
          lastName: result.data.lastName,
          profilePicture: result.data.profilePicture,
          designation: result.data.designation,
          designationLevel: result.data.designationLevel,
          designationLevelName: result.data.designationLevelName,
          department: result.data.department,
          departments: result.data.departments,
          employeeNumber: result.data.employeeNumber,
        }
        console.log('Synced User Data:', syncedUser)
        console.log('Formatted Designation:', formatDesignation(result.data.designation, result.data))
        localStorage.setItem('user', JSON.stringify(syncedUser))
        setUser(syncedUser)
      }
    } catch (error) {
      console.error('Error fetching employee data:', error)
    }
  }

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false)
      }
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

  // Update page title based on pathname
  useEffect(() => {
    const getPageTitle = (path) => {
      if (!path) return 'Home'

      // Remove /dashboard prefix
      const cleanPath = path.replace('/dashboard', '')

      if (cleanPath === '' || cleanPath === '/') return 'Home'

      // Map routes to titles
      const titleMap = {
        '/tasks': 'Projects',
        '/tasks/my-tasks': 'My Projects',
        '/tasks/team-tasks': 'Team Projects',
        '/tasks/create': 'Create Project',
        '/tasks/assign': 'Assign Projects',
        '/tasks/history': 'Project History',
        '/projects': 'Projects',
        '/projects/my-tasks': 'My Tasks',
        '/projects/create': 'Create Project',
        '/chat': 'Chat',
        '/leave': 'Leave',
        '/leave/apply': 'Apply Leave',
        '/leave/my-leaves': 'My Leaves',
        '/attendance': 'Attendance',
        '/profile': 'Profile',
        '/settings': 'Settings',
        '/team': 'Team',
        '/departments': 'Departments',
        '/designations': 'Designations',
        '/employees': 'Employees',
        '/recruitment': 'Recruitment',
        '/payroll': 'Payroll',
        '/announcements': 'Announcements',
        '/policies': 'Policies',
        '/assets': 'Assets',
        '/reports': 'Reports',
        '/sandbox': 'Ideas',
      }

      // Check for exact match
      if (titleMap[cleanPath]) return titleMap[cleanPath]

      // Check for project detail or edit pages (dynamic routes like /projects/[id] or /projects/[id]/edit)
      if (cleanPath.match(/^\/projects\/[a-f0-9]{24}(\/edit)?$/i)) {
        return cleanPath.endsWith('/edit') ? 'Edit Project' : 'Project Details'
      }

      // Check for partial match (for dynamic routes)
      for (const [route, title] of Object.entries(titleMap)) {
        if (cleanPath.startsWith(route)) return title
      }

      // Default: capitalize the last segment (Title Case)
      const segments = cleanPath.split('/').filter(Boolean)
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1]
        return lastSegment
          .replace(/-/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }

      return 'Home'
    }

    setPageTitle(getPageTitle(pathname))
  }, [pathname])

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

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('userId')
    // Clear cookie
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    toast.success('Logged out successfully')
    router.push('/login')
  }

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
        className="h-[60.5px] bg-white w-full z-[50] border-b border-gray-200 transition-all duration-300 flex-shrink-0"
      >
        <div className="flex items-center justify-between px-1 sm:px-4 lg:px-0 h-[45px] lg:h-[60px]">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <button
              onClick={toggleSidebar}
              className="lg:hidden focus:outline-none p-1"
            >
              <img
                src="/hamburger.png"
                alt="Menu"
                className="w-5 h-5"
                style={{ filter: 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
              />
            </button>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header 
      className="h-[60.5px] bg-white w-full z-[50] border-b border-gray-200 transition-all duration-300 flex-shrink-0"
    >
      <div className="flex items-center justify-between px-1 sm:px-4 lg:px-6 h-[60.5px] lg:h-[60px]">
        {/* Left side */}
        <div className="flex items-center space-x-2 sm:space-x-4 flex-1">
          <button
            onClick={toggleSidebar}
            className="lg:hidden focus:outline-none p-1"
          >
            <img
              src="/hamburger.png"
              alt="Menu"
              className="w-5 h-5"
              style={{ filter: 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
            />
          </button>

          {/* Search bar - Desktop */}
          <div ref={searchRef} className="hidden md:block relative w-64 lg:w-96">
            {/* Backdrop overlay when search is active */}
            {(showSearchResults || searchQuery.length >= 2) && (
              <div 
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
                onClick={() => {
                  setSearchQuery('')
                  setShowSearchResults(false)
                }}
              />
            )}
            
            {/* Unified Search Container */}
            <div className={`z-[101] ${(showSearchResults || searchQuery.length >= 2) ? 'fixed left-1/2 -translate-x-1/2 top-4 w-[90%] max-w-xl bg-white/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200 overflow-hidden' : 'relative'}`}>
              <div className="relative flex items-center">
                <FaSearch className="absolute left-3 text-gray-400 w-4 h-4 pointer-events-none z-10" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search everything..."
                  className={`w-full pl-10 pr-10 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-all ${(showSearchResults || searchQuery.length >= 2) ? 'bg-transparent border-b border-gray-200' : 'bg-gray-50 border border-gray-100 rounded-lg focus:ring-1 focus:border-transparent'}`}
                  style={{ '--tw-ring-color': primaryMedium }}
                />
                {searching && (
                  <FaSpinner className="absolute right-3 animate-spin w-4 h-4 z-10" style={{ color: primaryColor }} />
                )}
                {searchQuery && !searching && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setShowSearchResults(false)
                    }}
                    className="absolute right-3 text-gray-400 hover:text-gray-600 transition-colors z-10"
                  >
                    <FaTimes className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search Results - Integrated */}
              {showSearchResults && searchResults && (
                <div className="max-h-[60vh] overflow-y-auto scrollbar-hide">
                  {Object.entries(searchResults).map(([category, items]) => {
                    if (items.length === 0) return null
                    return (
                      <div key={category} className="border-b border-gray-100 last:border-b-0">
                        <div className="px-4 py-2 bg-gray-50/80 font-semibold text-xs text-gray-600 uppercase sticky top-0 backdrop-blur-sm">
                          {getCategoryLabel(category)} <span className="text-gray-400">({items.length})</span>
                        </div>
                        {items.map((item, index) => (
                          <div
                            key={item._id || index}
                            onClick={() => handleSearchResultClick(item.link)}
                            className="px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="font-medium text-sm text-gray-900 truncate">{item.title}</h4>
                                {item.meta && item.type !== 'page' && (
                                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{item.meta}</span>
                                )}
                              </div>
                              {item.subtitle && (
                                <p className="text-xs text-gray-500">{item.subtitle}</p>
                              )}
                              {item.description && (
                                <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{item.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {Object.values(searchResults).every(arr => arr.length === 0) && (
                    <div className="px-4 py-8 text-center text-gray-500">
                      <p className="text-sm font-medium">No results found for "{searchQuery}"</p>
                      <p className="text-xs text-gray-400 mt-1">Try different keywords</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center - Page Title */}
        <div className="absolute left-1/2 transform -translate-x-1/2">
          <h1 className="text-lg font-semibold" style={{ color: window.innerWidth >= 768 ? primaryColor : '#000000' }}>{pageTitle}</h1>
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2 sm:space-x-4 flex-1 justify-end">
          {/* Real-time Clock - Desktop Only */}
          <div className="hidden md:flex items-center gap-2 px-4 py-2.5 " style={{ color: 'var(--color-text-secondary)' }}>
            <RealTimeClock timezone={timezone} />
          </div>

          {/* PWA Status - Hidden */}
          {/* <PWAStatus /> */}

          {/* Mobile Search Icon */}
          <button
            onClick={() => setShowMobileSearch(true)}
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{
              color: 'var(--color-text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = primaryColor
              e.currentTarget.style.backgroundColor = primaryLight
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-secondary)'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <FaSearch className="w-5 h-5" />
          </button>

          {/* Notifications */}
          {/* <div ref={notifRef} className="relative mt-3 md:mt-0">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-1.5 sm:p-2  text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <FaBell className="w-[25px] h-[25px] sm:w-5 sm:h-5 mt-[-5px] md:mt-0 md:mr-0 mr-[-5px]" />
              <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-[1px] h-[1px] p-[5px]  bg-red-600 rounded-full"></div>
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-4 py-2 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Notifications</h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">New leave request from John Doe</p>
                    <p className="text-xs text-gray-500 mt-1">2 hours ago</p>
                  </div>
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">Payroll processed for December</p>
                    <p className="text-xs text-gray-500 mt-1">5 hours ago</p>
                  </div>
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">New announcement posted</p>
                    <p className="text-xs text-gray-500 mt-1">1 day ago</p>
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-gray-200 text-center">
                  <a href="/dashboard/notifications" className="text-sm text-primary-600 hover:text-primary-700">
                    View all notifications
                  </a>
                </div>
              </div>
            )}
          </div> */}

          {/* MIRA Cloud Button - Desktop Only */}
          <div className="hidden md:block relative group">
            <button
              onClick={() => setShowMiraModal(true)}
              className="relative p-2.5 rounded-xl transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-blue-50 group-hover:to-indigo-50"
              style={{
                color: 'var(--color-text-secondary)',
              }}
            >
              {/* MIRA AI Icon */}
              <div className="relative">
                <svg 
                  className="w-5 h-5 transition-all duration-300 group-hover:text-blue-500 group-hover:scale-110"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
                
                {/* Pulse effect on hover */}
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping transition-opacity" />
              </div>
              
              {/* Tooltip */}
              <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                MIRA Cloud
              </span>
            </button>
          </div>

          {/* Ideas Button - Desktop Only */}
          <div className="hidden md:block relative group">
            <button
              onClick={() => router.push('/dashboard/sandbox')}
              className="relative p-2.5 rounded-xl transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-yellow-50 group-hover:to-orange-50"
              style={{
                color: 'var(--color-text-secondary)',
              }}
            >
              {/* Animated lightbulb container */}
              <div className="relative">
                {/* Main lightbulb icon */}
                <svg 
                  className="w-5 h-5 transition-all duration-300 group-hover:text-yellow-500 group-hover:scale-110"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/>
                </svg>
                
                {/* Sparkle effects on hover */}
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping transition-opacity" />
                <span className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 bg-orange-400 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping transition-opacity" style={{ animationDelay: '0.2s' }} />
              </div>
              
              {/* Tooltip */}
              <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Ideas Sandbox
              </span>
            </button>
          </div>

          {/* Profile menu */}
          <div ref={profileRef} className="relative mt-1 md:mt-0">
            <button
              onClick={() => {
                // On mobile, go directly to profile
                if (window.innerWidth < 768) {
                  router.push('/dashboard/profile')
                } else {
                  setShowProfileMenu(!showProfileMenu)
                }
              }}
              className="flex items-center space-x-2 sm:space-x-3 p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <div className="relative">
                <div className="w-[30px] h-[30px] sm:w-8 sm:h-8 bg-primary-500 rounded-full flex items-center justify-center overflow-hidden">
                  {employeeData?.profilePicture ? (
                    <img
                      src={employeeData.profilePicture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-white text-xs sm:text-sm font-medium">{getUserInitials()}</span>
                  )}
                </div>
                {/* Notification badge placeholder - can be added here if needed */}
                {/* Example: {hasNotifications && <UnreadBadge count={notificationCount} className="top-0 right-0" />} */}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-900 truncate max-w-32">
                  {employeeData ? `${employeeData.firstName} ${employeeData.lastName}` :
                    user?.firstName ? `${user.firstName} ${user.lastName}` :
                      user?.email || 'User'}
                </p>
                <p className="text-xs text-gray-500">
                  {formatDesignation(employeeData?.designation || user?.designation, employeeData) || user?.role || 'Employee'}
                </p>
              </div>
            </button>

            {showProfileMenu && (
              <>
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[102]" onClick={() => setShowProfileMenu(false)} />
                <div className="absolute right-0 mt-2 w-44 sm:w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-[103]">
                  {/* User Info Section */}
                  <div className="px-2 md:px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
                        {(employeeData?.profilePicture || user?.profilePicture) ? (
                          <img
                            src={employeeData?.profilePicture || user?.profilePicture}
                            alt="Profile"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-white text-sm font-medium">{getUserInitials()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {employeeData ? `${employeeData.firstName} ${employeeData.lastName}` :
                            user?.firstName ? `${user.firstName} ${user.lastName}` :
                              user?.email || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {formatDesignation(employeeData?.designation || user?.designation, employeeData) || user?.role || 'Employee'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <a
                    href="/dashboard/profile"
                    className="flex items-center space-x-2 px-2 md:px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FaUser className="w-4 h-4" />
                    <span>My Profile</span>
                  </a>
                  <a
                    href="/dashboard/settings"
                    className="flex items-center space-x-2 px-2 py-2 md:px-4 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FaCog className="w-4 h-4" />
                    <span>Settings</span>
                  </a>
                  <hr className="my-2" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center space-x-2 px-2 md:px-4 py-2 md:pl-4  text-sm text-red-600 hover:bg-gray-100 w-full text-left"
                  >
                    <FaSignOutAlt className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Search Fullscreen Modal */}
      {showMobileSearch && (
        <div className="fixed inset-0 bg-white z-[100] md:hidden">
          <div className="flex flex-col h-full">
            {/* Search Header - Match header height */}
            <div className="flex items-center gap-3 px-3 h-16 border-b border-gray-200 bg-white">
              <button
                onClick={closeMobileSearch}
                className="p-2 text-gray-600 hover:text-gray-800 flex-shrink-0"
              >
                <FaTimes className="w-5 h-5" />
              </button>
              <div className="flex-1 relative">
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search everything..."
                  className="w-full h-11 pl-10 pr-10 bg-gray-50 border border-gray-100 rounded-lg focus:ring-1 focus:border-transparent text-sm"
                  style={{ '--tw-ring-color': primaryMedium }}
                  autoFocus
                />
                {searchQuery && !searching && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSearchResults(null)
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <FaTimes className="w-4 h-4" />
                  </button>
                )}
                {searching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <FaSpinner className="animate-spin w-4 h-4" style={{ color: primaryColor }} />
                  </div>
                )}
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto">
              {searchQuery.length < 2 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4">
                  <FaSearch className="w-16 h-16 mb-4 text-gray-300" />
                  <p className="text-lg font-medium">Search Everything</p>
                  <p className="text-sm text-center mt-2">
                    Find pages, tasks, leaves, announcements, and more...
                  </p>
                </div>
              ) : searching ? (
                <div className="flex items-center justify-center h-full">
                  <FaSpinner className="animate-spin w-8 h-8" style={{ color: primaryColor }} />
                </div>
              ) : searchResults ? (
                <div>
                  {Object.entries(searchResults).map(([category, items]) => {
                    if (items.length === 0) return null
                    return (
                      <div key={category} className="border-b border-gray-100">
                        <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-gray-100 font-semibold text-sm text-gray-700 uppercase sticky top-0 z-10">
                          {getCategoryLabel(category)} <span className="text-gray-500">({items.length})</span>
                        </div>
                        {items.map((item, index) => (
                          <div
                            key={item._id || index}
                            onClick={() => handleSearchResultClick(item.link)}
                            className="px-4 py-4 cursor-pointer border-b border-gray-50 transition-colors"
                            style={{
                              backgroundColor: 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = primaryLight
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                            onTouchStart={(e) => {
                              e.currentTarget.style.backgroundColor = theme?.primary?.[100] || '#DBEAFE'
                            }}
                            onTouchEnd={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-base text-gray-900">{item.title}</h4>
                              </div>
                                {item.subtitle && (
                                  <p className="text-sm mb-1" style={{ color: primaryColor }}>{item.subtitle}</p>
                                )}
                                {item.description && (
                                  <p className="text-sm text-gray-500 line-clamp-2">{item.description}</p>
                                )}
                                {item.meta && item.type !== 'page' && (
                                  <span className="inline-block text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded mt-2">
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
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4 py-12">
                      <FaSearch className="w-16 h-16 mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No results found</p>
                      <p className="text-sm text-center mt-2 text-gray-500">
                        Try different keywords or check spelling
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* MIRA Cloud Fullscreen Modal */}
      {showMiraModal && (
        <div 
          className="fixed inset-0 animate-fadeIn"
          style={{ zIndex: 99999 }}
        >
          {/* Close button */}
          <button
            onClick={() => setShowMiraModal(false)}
            className="absolute top-4 right-4 z-[100000] p-3 bg-gray-900/80 hover:bg-gray-900 rounded-full transition-all duration-200 group shadow-lg"
          >
            <FaTimes className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
          </button>
          
          {/* Iframe - fullscreen */}
          <iframe
            src="https://itsmira.cloud"
            className="w-full h-full border-0"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            allow="microphone; camera; clipboard-read; clipboard-write"
            title="MIRA Cloud"
          />
        </div>
      )}
    </header>
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
      <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {formatTime(time)}
      </div>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {formatDate(time)}
      </div>
    </div>
  )
}
