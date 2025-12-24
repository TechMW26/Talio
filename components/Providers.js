'use client'

import { useEffect, useCallback } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { checkAndClearCaches } from '@/lib/cacheManager'

/**
 * Check if running in Electron/desktop app environment
 * Multiple detection methods for reliability
 */
function isElectronApp() {
    if (typeof window === 'undefined') return false
    
    // Method 1: Check talioDesktop API from preload
    if (window.talioDesktop?.isDesktopApp) return true
    
    // Method 2: Check user agent for Electron
    if (navigator.userAgent.toLowerCase().includes('electron')) return true
    
    // Method 3: Check for Electron-specific objects
    if (window.process?.type === 'renderer') return true
    
    // Method 4: Check if running in a non-standard browser context (no window.chrome, etc.)
    // Electron doesn't have chrome.runtime
    if (typeof window.require === 'function') return true
    
    return false
}

export function Providers({ children }) {
    // Defer non-critical initialization
    const initializeNonCritical = useCallback(async () => {
        // Skip audio initialization in desktop app to prevent issues
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

    // Check for version changes and clear caches if needed
    useEffect(() => {
        // CRITICAL: Skip ALL cache and reload operations in desktop app
        // This prevents white screen issues caused by reload loops
        if (isElectronApp()) {
            console.log('[Providers] Desktop app detected, skipping all cache operations')
            return
        }
        
        // Use requestIdleCallback for non-critical cache check
        const scheduleCheck = () => {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => {
                    checkAndClearCaches().then((cleared) => {
                        if (cleared) {
                            console.log('[Providers] Caches cleared due to version update, reloading...');
                            window.location.reload();
                        }
                    });
                });
            } else {
                // Fallback for browsers without requestIdleCallback
                setTimeout(() => {
                    checkAndClearCaches().then((cleared) => {
                        if (cleared) {
                            console.log('[Providers] Caches cleared due to version update, reloading...');
                            window.location.reload();
                        }
                    });
                }, 100);
            }
        };
        
        scheduleCheck();
        
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
        <ThemeProvider>
            {children}
        </ThemeProvider>
    )
}
