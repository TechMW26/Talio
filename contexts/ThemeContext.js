'use client'

import { createContext, useContext, useEffect } from 'react'

const ThemeContext = createContext()
const neutral = {
  name: 'Talio Black',
  primary: { 50: '#141414', 100: '#202020', 200: '#333333', 300: '#b0b0b0', 400: '#cccccc', 500: '#737373', 600: '#a3a3a3', 700: '#d4d4d4', 800: '#e5e5e5', 900: '#fafafa' },
  background: { main: '#090909', card: '#171717', sidebar: '#111111', hover: '#262626' },
  text: { primary: '#fafafa', secondary: '#a3a3a3' },
  accent: { profile: '#171717', gradient: 'linear-gradient(135deg, #262626, #111111)' },
  sidebarDark: true,
}
export const themes = { default: neutral }
// Preserve the context contract while appearance is fixed.
const fixedAppearance = () => {}
const value = { currentTheme: 'default', themes, theme: neutral, isDarkMode: true, darkModePref: 'dark', changeTheme: fixedAppearance, setDarkModePreference: fixedAppearance, toggleDarkMode: fixedAppearance }

export function ThemeProvider({ children }) {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
    Object.entries(neutral.primary).forEach(([shade, color]) => root.style.setProperty(`--color-primary-${shade}`, color))
    Object.entries(neutral.background).forEach(([key, color]) => root.style.setProperty(`--color-bg-${key}`, color))
    Object.entries(neutral.text).forEach(([key, color]) => root.style.setProperty(`--color-text-${key}`, color))
    root.style.setProperty('--color-accent-profile', neutral.accent.profile)
    root.style.setProperty('--color-accent-gradient', neutral.accent.gradient)
    root.style.setProperty('--color-border', '#303030')
  }, [])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

