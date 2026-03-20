'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext()

// Dark mode background/text overrides applied on top of any color theme
const darkOverrides = {
  background: {
    main: '#0F172A',       // Slate-900
    card: '#1E293B',       // Slate-800
    sidebar: '#1E293B',    // Slate-800
    hover: '#334155',      // Slate-700
  },
  text: {
    primary: '#F1F5F9',    // Slate-100
    secondary: '#94A3B8',  // Slate-400
  },
  accent: {
    profile: '#0F172A',
  },
  border: '#334155',       // Slate-700
}

// Theme configurations
export const themes = {
  default: {
    name: 'Default Blue',
    primary: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      200: '#BFDBFE',
      300: '#93C5FD',
      400: '#60A5FA',
      500: '#3B82F6',
      600: '#2563EB',
      700: '#1D4ED8',
      800: '#1E40AF',
      900: '#1E3A8A',
    },
    background: {
      main: '#F9FAFB',       // Original light gray background
      card: '#ffffff',       // Original card color
      sidebar: '#FFFFFF',    // White sidebar for professional look
      hover: '#EFF6FF',      // Light blue hover for sidebar
    },
    text: {
      primary: '#1E40AF',    // Dark blue text for white sidebar (primary-800)
      secondary: '#6B7280',  // Gray text for secondary items
    },
    accent: {
      profile: '#1A295A',    // Profile card background (dark blue)
      gradient: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)', // Gradient for special cards
    },
    sidebarDark: false,      // Flag to indicate light sidebar
  },
  purple: {
    name: 'Purple Dream',
    primary: {
      50: '#FAF5FF',
      100: '#F3E8FF',
      200: '#E9D5FF',
      300: '#D8B4FE',
      400: '#C084FC',
      500: '#A855F7',
      600: '#9333EA',
      700: '#7E22CE',
      800: '#6B21A8',
      900: '#581C87',
    },
    background: {
      main: '#FAF5FF',       // Soft pastel purple background
      card: '#FFFFFF',       // White cards for contrast
      sidebar: '#FFFFFF',    // White sidebar for professional look
      hover: '#FAF5FF',      // Light purple hover for sidebar
    },
    text: {
      primary: '#6B21A8',    // Dark purple text for white sidebar (primary-800)
      secondary: '#6B7280',  // Gray text for secondary items
    },
    accent: {
      profile: '#581C87',    // Profile card background (dark purple)
      gradient: 'linear-gradient(135deg, #6B21A8 0%, #A855F7 100%)', // Purple gradient
    },
    sidebarDark: false,
  },
  green: {
    name: 'Fresh Green',
    primary: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      200: '#BBF7D0',
      300: '#86EFAC',
      400: '#4ADE80',
      500: '#22C55E',
      600: '#16A34A',
      700: '#15803D',
      800: '#166534',
      900: '#14532D',
    },
    background: {
      main: '#F0FDF4',       // Soft pastel green background
      card: '#FFFFFF',       // White cards for contrast
      sidebar: '#FFFFFF',    // White sidebar for professional look
      hover: '#F0FDF4',      // Light green hover for sidebar
    },
    text: {
      primary: '#166534',    // Dark green text for white sidebar (primary-800)
      secondary: '#6B7280',  // Gray text for secondary items
    },
    accent: {
      profile: '#14532D',    // Profile card background (dark green)
      gradient: 'linear-gradient(135deg, #166534 0%, #22C55E 100%)', // Green gradient
    },
    sidebarDark: false,
  },
  orange: {
    name: 'Warm Orange',
    primary: {
      50: '#FFF7ED',
      100: '#FFEDD5',
      200: '#FED7AA',
      300: '#FDBA74',
      400: '#FB923C',
      500: '#F97316',
      600: '#EA580C',
      700: '#C2410C',
      800: '#9A3412',
      900: '#7C2D12',
    },
    background: {
      main: '#FFF7ED',       // Soft pastel orange background
      card: '#FFFFFF',       // White cards for contrast
      sidebar: '#FFFFFF',    // White sidebar for professional look
      hover: '#FFF7ED',      // Light orange hover for sidebar
    },
    text: {
      primary: '#9A3412',    // Dark orange text for white sidebar (primary-800)
      secondary: '#6B7280',  // Gray text for secondary items
    },
    accent: {
      profile: '#7C2D12',    // Profile card background (dark orange)
      gradient: 'linear-gradient(135deg, #9A3412 0%, #F97316 100%)', // Orange gradient
    },
    sidebarDark: false,
  },
  teal: {
    name: 'Ocean Teal',
    primary: {
      50: '#F0FDFA',
      100: '#CCFBF1',
      200: '#99F6E4',
      300: '#5EEAD4',
      400: '#2DD4BF',
      500: '#14B8A6',
      600: '#0D9488',
      700: '#0F766E',
      800: '#115E59',
      900: '#134E4A',
    },
    background: {
      main: '#F0FDFA',       // Soft pastel teal background
      card: '#FFFFFF',       // White cards for contrast
      sidebar: '#FFFFFF',    // White sidebar for professional look
      hover: '#F0FDFA',      // Light teal hover for sidebar
    },
    text: {
      primary: '#115E59',    // Dark teal text for white sidebar (primary-800)
      secondary: '#6B7280',  // Gray text for secondary items
    },
    accent: {
      profile: '#134E4A',    // Profile card background (dark teal)
      gradient: 'linear-gradient(135deg, #115E59 0%, #14B8A6 100%)', // Teal gradient
    },
    sidebarDark: false,
  }
}

export function ThemeProvider({ children }) {
  const [currentTheme, setCurrentTheme] = useState('default')
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [darkModePref, setDarkModePref] = useState('auto') // 'auto' | 'light' | 'dark'
  const [isInitialized, setIsInitialized] = useState(false)

  // Apply CSS variables for the current theme + dark mode
  const applyTheme = useCallback((themeName, darkMode) => {
    const theme = themes[themeName]
    if (!theme) return

    try {
      if (typeof document === 'undefined') return
      
      const root = document.documentElement

      // Apply primary colors (same for light and dark)
      Object.keys(theme.primary).forEach(shade => {
        root.style.setProperty(`--color-primary-${shade}`, theme.primary[shade])
      })

      if (darkMode) {
        // Dark mode: override background and text with dark values
        root.style.setProperty('--color-bg-main', darkOverrides.background.main)
        root.style.setProperty('--color-bg-card', darkOverrides.background.card)
        root.style.setProperty('--color-bg-sidebar', darkOverrides.background.sidebar)
        root.style.setProperty('--color-bg-hover', darkOverrides.background.hover)
        root.style.setProperty('--color-text-primary', darkOverrides.text.primary)
        root.style.setProperty('--color-text-secondary', darkOverrides.text.secondary)
        root.style.setProperty('--color-accent-profile', darkOverrides.accent.profile)
        root.style.setProperty('--color-accent-gradient', theme.accent.gradient)
        root.style.setProperty('--color-border', darkOverrides.border)
        // Override light primary shades to dark-appropriate tints
        root.style.setProperty('--color-primary-50', `color-mix(in srgb, ${theme.primary[500]} 8%, #0F172A)`)
        root.style.setProperty('--color-primary-100', `color-mix(in srgb, ${theme.primary[500]} 18%, #1E293B)`)
        root.style.setProperty('--color-primary-200', `color-mix(in srgb, ${theme.primary[500]} 28%, #1E293B)`)
        root.classList.add('dark')
      } else {
        // Light mode: use theme's own values
        root.style.setProperty('--color-bg-main', theme.background.main)
        root.style.setProperty('--color-bg-card', theme.background.card)
        root.style.setProperty('--color-bg-sidebar', theme.background.sidebar)
        root.style.setProperty('--color-bg-hover', theme.background.hover)
        root.style.setProperty('--color-text-primary', theme.text.primary)
        root.style.setProperty('--color-text-secondary', theme.text.secondary)
        root.style.setProperty('--color-accent-profile', theme.accent.profile)
        root.style.setProperty('--color-accent-gradient', theme.accent.gradient)
        root.style.setProperty('--color-border', '#E5E7EB')
        // Restore original primary shades
        root.style.setProperty('--color-primary-50', theme.primary[50])
        root.style.setProperty('--color-primary-100', theme.primary[100])
        root.style.setProperty('--color-primary-200', theme.primary[200])
        root.classList.remove('dark')
      }
    } catch (err) {
      console.warn('[ThemeProvider] Failed to apply theme:', err)
    }
  }, [])

  // Resolve whether dark mode is active based on preference + system
  const resolveDarkMode = useCallback((pref) => {
    if (pref === 'dark') return true
    if (pref === 'light') return false
    // 'auto' - follow system
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  }, [])

  // Load theme + dark mode preference on mount
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('app-theme')
      const savedPref = localStorage.getItem('app-dark-mode-pref') || 'auto'
      
      const themeToApply = (savedTheme && themes[savedTheme]) ? savedTheme : 'default'
      const resolvedDark = resolveDarkMode(savedPref)

      setCurrentTheme(themeToApply)
      setDarkModePref(savedPref)
      setIsDarkMode(resolvedDark)
      applyTheme(themeToApply, resolvedDark)
    } catch (err) {
      console.warn('[ThemeProvider] localStorage not available:', err)
      const systemDark = resolveDarkMode('auto')
      setIsDarkMode(systemDark)
      applyTheme('default', systemDark)
    }
    setIsInitialized(true)
  }, [applyTheme, resolveDarkMode])

  // Listen for system color-scheme changes when preference is 'auto'
  useEffect(() => {
    if (darkModePref !== 'auto') return
    if (typeof window === 'undefined') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    // Handler for live system theme changes
    const handleChange = (e) => {
      setIsDarkMode(e.matches)
      applyTheme(currentTheme, e.matches)
    }

    // Re-check system theme when tab becomes visible (some browsers
    // don't fire matchMedia 'change' while the tab is backgrounded)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const systemDark = mq.matches
        setIsDarkMode(prev => {
          if (prev !== systemDark) {
            applyTheme(currentTheme, systemDark)
          }
          return systemDark
        })
      }
    }

    mq.addEventListener('change', handleChange)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      mq.removeEventListener('change', handleChange)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [darkModePref, currentTheme, applyTheme])

  const changeTheme = (themeName) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName)
      applyTheme(themeName, isDarkMode)
      try {
        localStorage.setItem('app-theme', themeName)
      } catch (err) {
        console.warn('[ThemeProvider] Failed to save theme:', err)
      }
    }
  }

  // Set dark mode preference: 'auto' | 'light' | 'dark'
  // Pass a MouseEvent as second arg to trigger the wave transition
  const setDarkModePreference = (pref, event) => {
    const applyChange = () => {
      setDarkModePref(pref)
      const resolved = resolveDarkMode(pref)
      setIsDarkMode(resolved)
      applyTheme(currentTheme, resolved)
      try {
        localStorage.setItem('app-dark-mode-pref', pref)
        // Keep legacy key in sync for flash-prevention script
        localStorage.setItem('app-dark-mode', String(resolved))
      } catch (err) {
        console.warn('[ThemeProvider] Failed to save dark mode:', err)
      }
    }

    // Wave transition using View Transitions API
    // Circle expands from the toggle to reveal the new theme
    if (event && typeof document !== 'undefined' && document.startViewTransition) {
      // Use the center of the toggle button, not raw click coords
      const toggle = event.currentTarget
      const rect = toggle.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      const maxX = Math.max(x, window.innerWidth - x)
      const maxY = Math.max(y, window.innerHeight - y)
      const radius = Math.ceil(Math.hypot(maxX, maxY))

      // 1. Set clip-path origin as CSS vars so the CSS rule
      //    pre-clips ::view-transition-new(root) at circle(0px) from frame 0
      const root = document.documentElement
      root.style.setProperty('--vt-x', `${x}px`)
      root.style.setProperty('--vt-y', `${y}px`)

      // 2. Kill CSS transitions + force fixed elements out of
      //    separate GPU compositing layers (the root cause of the sidebar flicker)
      root.classList.add('theme-switching')

      // 3. Force style recalc so CSS vars + classes are applied
      //    BEFORE startViewTransition captures the old snapshot
      getComputedStyle(root).getPropertyValue('--vt-x')

      const transition = document.startViewTransition(() => {
        applyChange()
      })

      // 4. Expand circle from toggle center on BOTH root and sidebar snapshots
      transition.ready.then(() => {
        const keyframes = {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        }
        const timing = {
          duration: 500,
          easing: 'ease-in-out',
          fill: 'forwards',
        }
        // Animate the root (everything except sidebar)
        root.animate(keyframes, { ...timing, pseudoElement: '::view-transition-new(root)' })
        // Animate the sidebar snapshot with the same circle
        // (may not exist if sidebar is not rendered, e.g. mobile)
        try {
          root.animate(keyframes, { ...timing, pseudoElement: '::view-transition-new(sidebar)' })
        } catch (_) { /* sidebar not in DOM */ }
      })

      // 5. Clean up after transition finishes
      transition.finished.then(() => {
        root.classList.remove('theme-switching')
        root.style.removeProperty('--vt-x')
        root.style.removeProperty('--vt-y')
      }).catch(() => {
        root.classList.remove('theme-switching')
        root.style.removeProperty('--vt-x')
        root.style.removeProperty('--vt-y')
      })
    } else {
      applyChange()
    }
  }

  // Legacy toggle - cycles auto → dark → light → auto
  const toggleDarkMode = () => {
    const next = darkModePref === 'auto' ? 'dark' : darkModePref === 'dark' ? 'light' : 'auto'
    setDarkModePreference(next)
  }

  return (
    <ThemeContext.Provider value={{ currentTheme, changeTheme, themes, theme: themes[currentTheme], isDarkMode, darkModePref, setDarkModePreference, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

