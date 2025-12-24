'use client'

import { useEffect } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { checkAndClearCaches } from '@/lib/cacheManager'
import { initAudio } from '@/utils/audio'

export function Providers({ children }) {
    // Check for version changes and clear caches if needed
    useEffect(() => {
        checkAndClearCaches().then((cleared) => {
            if (cleared) {
                console.log('[Providers] Caches cleared due to version update, reloading...');
                // Reload to get fresh content after clearing caches
                window.location.reload();
            }
        });
        
        // Initialize audio system (preloads sounds and sets up unlock listener)
        if (typeof window !== 'undefined') {
            initAudio();
        }
    }, []);

    return (
        <ThemeProvider>
            {children}
        </ThemeProvider>
    )
}
