'use client'

import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

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
  const [isInitialized, setIsInitialized] = useState(false)

  // Load theme from localStorage on mount - NON-BLOCKING
  useEffect(() => {
    // Wrap in try-catch for Electron/SSR safety
    try {
      const savedTheme = localStorage.getItem('app-theme')
      if (savedTheme && themes[savedTheme]) {
        setCurrentTheme(savedTheme)
        applyTheme(savedTheme)
      } else {
        applyTheme('default')
      }
    } catch (err) {
      console.warn('[ThemeProvider] localStorage not available:', err)
      applyTheme('default')
    }
    setIsInitialized(true)
  }, [])

  const applyTheme = (themeName) => {
    const theme = themes[themeName]
    if (!theme) return

    // Wrap in try-catch for SSR/Electron safety
    try {
      if (typeof document === 'undefined') return
      
      const root = document.documentElement

      // Apply primary colors
      Object.keys(theme.primary).forEach(shade => {
        root.style.setProperty(`--color-primary-${shade}`, theme.primary[shade])
      })

    // Apply background colors
    root.style.setProperty('--color-bg-main', theme.background.main)
    root.style.setProperty('--color-bg-card', theme.background.card)
    root.style.setProperty('--color-bg-sidebar', theme.background.sidebar)
    root.style.setProperty('--color-bg-hover', theme.background.hover)

    // Apply text colors
    root.style.setProperty('--color-text-primary', theme.text.primary)
    root.style.setProperty('--color-text-secondary', theme.text.secondary)

    // Apply accent colors
    root.style.setProperty('--color-accent-profile', theme.accent.profile)
    root.style.setProperty('--color-accent-gradient', theme.accent.gradient)
    } catch (err) {
      console.warn('[ThemeProvider] Failed to apply theme:', err)
    }
  }

  const changeTheme = (themeName) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName)
      applyTheme(themeName)
      try {
        localStorage.setItem('app-theme', themeName)
      } catch (err) {
        console.warn('[ThemeProvider] Failed to save theme:', err)
      }
    }
  }

  return (
    <ThemeContext.Provider value={{ currentTheme, changeTheme, themes, theme: themes[currentTheme] }}>
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

