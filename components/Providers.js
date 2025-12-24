'use client'

import { useEffect, useCallback } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { checkAndClearCaches } from '@/lib/cacheManager'

export function Providers({ children }) {
    // Defer non-critical initialization
    const initializeNonCritical = useCallback(async () => {
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
