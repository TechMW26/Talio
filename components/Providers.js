'use client'

import { useEffect, useCallback } from 'react'
import { SWRConfig } from 'swr'
import { HeroUIProvider } from '@heroui/react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AILoadingProvider } from '@/contexts/AILoadingContext'
import { AIAssistantProvider } from '@/contexts/AIAssistantContext'
import GlobalAILoadingOverlay from '@/components/ui/GlobalAILoadingOverlay'
import MiraTransitionOverlay from '@/components/ui/MiraTransitionOverlay'
import AIAssistant from '@/components/AIAssistant'
import AIAssistantBridge from '@/components/AIAssistantBridge'
import AutoRefresh from '@/components/AutoRefresh'
import WebNetworkRecovery from '@/components/WebNetworkRecovery'
import ScrollToTop from '@/components/ScrollToTop'
import { FocusTimerProvider } from '@/contexts/FocusTimerContext'
import { MiraChatProvider } from '@/contexts/MiraChatContext'
import {
    patchBrowserFetchForFreshness,
    revalidateAllApiQueries,
    subscribeToClientDataChanges
} from '@/lib/clientDataSync'

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
    useEffect(() => {
        const restoreFetch = patchBrowserFetchForFreshness()
        const unsubscribe = subscribeToClientDataChanges(() => {
            revalidateAllApiQueries()
        })

        return () => {
            unsubscribe()
            restoreFetch()
        }
    }, [])

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
                <AIAssistantProvider>
                <FocusTimerProvider>
                <MiraChatProvider>
                    <SWRConfig
                        value={{
                            // Stale-while-revalidate: show cached data immediately
                            revalidateOnFocus: false,
                            revalidateOnReconnect: true,
                            // Keep deduping short so mutation-triggered revalidations are not delayed.
                            dedupingInterval: 2000,
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
                        <AIAssistant />
                        <AIAssistantBridge />
                        {children}
                    </SWRConfig>
                </MiraChatProvider>
                </FocusTimerProvider>
                </AIAssistantProvider>
                </AILoadingProvider>
            </ThemeProvider>
        </HeroUIProvider>
    )
}
