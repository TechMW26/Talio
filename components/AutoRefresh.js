'use client'

import { usePathname } from 'next/navigation'
import useAutoRefresh from '@/hooks/useAutoRefresh'

/**
 * AutoRefresh component that automatically refreshes the page on:
 * 1. 5 minutes of inactivity
 * 2. User returning to tab after being away (2+ minutes)
 * 3. Device wake from sleep
 * 
 * Only active on dashboard pages (not login, register, etc.)
 */
export default function AutoRefresh() {
  const pathname = usePathname()
  
  // Only enable auto-refresh on dashboard pages
  const isAuthenticatedPage = pathname?.startsWith('/dashboard')
  
  useAutoRefresh({
    inactivityTimeout: 5 * 60 * 1000, // 5 minutes inactivity
    minAwayTime: 2 * 60 * 1000, // Refresh if away for 2+ minutes
    refreshOnVisibilityChange: true,
    enabled: isAuthenticatedPage,
    onRefresh: () => {
      // Optional: Clear any stale state before refresh
      console.log('🔄 [AutoRefresh] Refreshing page for fresh data...')
    }
  })

  // This component doesn't render anything
  return null
}
