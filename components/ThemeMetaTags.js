'use client'

import { useEffect } from 'react'
import { useTheme, themes } from '@/contexts/ThemeContext'

export default function ThemeMetaTags() {
  const { currentTheme, isDarkMode } = useTheme()

  useEffect(() => {
    const theme = themes[currentTheme]
    if (!theme) return

    // Set theme-color based on dark mode
    const themeColor = isDarkMode ? '#1E293B' : '#ffffff'

    let themeColorMeta = document.querySelector('meta[name="theme-color"]')
    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta')
      themeColorMeta.name = 'theme-color'
      document.head.appendChild(themeColorMeta)
    }
    themeColorMeta.setAttribute('content', themeColor)

    // Update msapplication-navbutton-color
    let msNavButtonMeta = document.querySelector('meta[name="msapplication-navbutton-color"]')
    if (!msNavButtonMeta) {
      msNavButtonMeta = document.createElement('meta')
      msNavButtonMeta.name = 'msapplication-navbutton-color'
      document.head.appendChild(msNavButtonMeta)
    }
    msNavButtonMeta.setAttribute('content', themeColor)

    // Update msapplication-TileColor
    let msTileColorMeta = document.querySelector('meta[name="msapplication-TileColor"]')
    if (!msTileColorMeta) {
      msTileColorMeta = document.createElement('meta')
      msTileColorMeta.name = 'msapplication-TileColor'
      document.head.appendChild(msTileColorMeta)
    }
    msTileColorMeta.setAttribute('content', themeColor)
  }, [currentTheme, isDarkMode])

  return null
}

