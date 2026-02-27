'use client'

import { useEffect, useCallback } from 'react'
import { SWRConfig } from 'swr'
import { HeroUIProvider } from '@heroui/react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AILoadingProvider } from '@/contexts/AILoadingContext'
import GlobalAILoadingOverlay from '@/components/ui/GlobalAILoadingOverlay'
import MiraTransitionOverlay from '@/components/ui/MiraTransitionOverlay'
import AutoRefresh from '@/components/AutoRefresh'
import WebNetworkRecovery from '@/components/WebNetworkRecovery'
import ScrollToTop from '@/components/ScrollToTop'

// Cache operations completely disabled - no imports needed
// import { checkAndClearCaches } from '@/lib/cacheManager'

/**
 * Check if running in Electron/desktop app environment
 */
function isElectronApp() {
    if (typeof window === 'undefined') return false
    if (window.electronAPI) return true
    if (window.talioDesktop?.isDesktopApp) return true
    if (navigator.userAgent.toLowerCase().includes('electron')) return true
    return false
}

export function Providers({ children }) {
    // Defer non-critical initialization (audio only)
    const initializeNonCritical = useCallback(async () => {
        // CRITICAL: Skip audio initialization for desktop apps
        // AudioContext can crash the Electron renderer process
        if (isElectronApp()) {
            console.log('[Providers] Desktop app detected, skipping audio init')
            return
        }
        
        // Initialize audio system lazily (don't block render)
        try {
            const { initAudio } = await import('@/utils/audio')
            initAudio()
        } catch (err) {
            console.warn('[Providers] Audio init failed:', err)
        }
    }, [])

    // NO cache operations - completely disabled to prevent white screen issues
    // on desktop apps (Windows/Mac), Android app, and web
    useEffect(() => {
        // Skip audio init entirely for desktop apps
        if (isElectronApp()) {
            console.log('[Providers] Desktop app - audio disabled')
            return
        }
        
        // Initialize audio after first user interaction or after delay
        const initOnInteraction = () => {
            initializeNonCritical();
            document.removeEventListener('click', initOnInteraction);
            document.removeEventListener('touchstart', initOnInteraction);
        };
        
        document.addEventListener('click', initOnInteraction, { once: true });
        document.addEventListener('touchstart', initOnInteraction, { once: true });
        
        // Also init after 3 seconds if no interaction
        const timer = setTimeout(initializeNonCritical, 3000);
        
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', initOnInteraction);
            document.removeEventListener('touchstart', initOnInteraction);
        };
    }, [initializeNonCritical]);

    return (
        <HeroUIProvider>
            <ThemeProvider>
                <AILoadingProvider>
                    <SWRConfig
                        value={{
                            // Stale-while-revalidate: show cached data immediately
                            revalidateOnFocus: false,
                            revalidateOnReconnect: true,
                            // Dedupe requests aggressively to reduce network calls
                            dedupingInterval: 60_000,
                            // Retry on error with backoff
                            shouldRetryOnError: true,
                            errorRetryInterval: 5000,
                            errorRetryCount: 2,
                            // Keep previous data while loading to prevent flashing
                            keepPreviousData: true,
                            // Don't suspend - render immediately with stale data
                            suspense: false,
                            // Fallback data for SSR/slow networks
                            fallback: {},
                            // Use IndexedDB/localStorage for persistent cache
                            provider: () => new Map(),
                        }}
                    >
                        <MiraTransitionOverlay />
                        <GlobalAILoadingOverlay />
                        <ScrollToTop />
                        <WebNetworkRecovery />
                        <AutoRefresh />
                        {children}
                    </SWRConfig>
                </AILoadingProvider>
            </ThemeProvider>
        </HeroUIProvider>
    )
}
