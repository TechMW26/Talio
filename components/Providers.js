'use client'

import { useEffect } from 'react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { checkAndClearCaches } from '@/lib/cacheManager'

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
    }, []);

    return (
        <ThemeProvider>
            {children}
        </ThemeProvider>
    )
}
