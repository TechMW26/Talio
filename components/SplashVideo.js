'use client';

import { useState, useEffect, useRef, createContext, useContext } from 'react';

// Context to track splash completion
const SplashContext = createContext({ splashComplete: true });

export const useSplashComplete = () => useContext(SplashContext);

/**
 * Check if running in Electron/desktop app environment
 */
function isElectronApp() {
  if (typeof window === 'undefined') return false
  if (window.talioDesktop?.isDesktopApp) return true
  if (navigator.userAgent.toLowerCase().includes('electron')) return true
  if (window.process?.type === 'renderer') return true
  return false
}

/**
 * SplashVideo Component
 * Shows a lightweight CSS-based splash screen on first session start.
 * 
 * PERFORMANCE FIX: Previously used a 936KB Lottie animation (splash-animation.json)
 * containing 83 embedded base64 webp images, causing 166+ network requests on page load.
 * Now uses a pure CSS animation with the existing app icon - zero extra requests.
 * 
 * NON-BLOCKING: Children always render immediately, splash is just an overlay on top.
 */
export default function SplashVideo({ children }) {
  const [showSplash, setShowSplash] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (initRef.current) return;
    initRef.current = true;

    // Skip splash entirely for desktop app
    if (isElectronApp()) {
      console.log('[SplashVideo] Desktop app detected, skipping splash');
      return;
    }

    // Check if this is the first session start
    try {
      const hasSeenSplash = sessionStorage.getItem('talio_splash_shown');

      if (!hasSeenSplash) {
        // Show splash overlay (children still render underneath)
        setShowSplash(true);
        setIsAnimating(true);

        // Set theme color for mobile
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
          metaTheme.setAttribute('content', '#fbfcfc');
        }

        // Auto-close after 2.5 seconds
        setTimeout(() => {
          handleAnimationEnd();
        }, 2500);
      }
    } catch (e) {
      console.warn('[SplashVideo] sessionStorage not available:', e);
    }
  }, []);

  const handleAnimationEnd = () => {
    try {
      sessionStorage.setItem('talio_splash_shown', 'true');
    } catch (e) {
      // Ignore sessionStorage errors
    }

    // Fade out and hide splash overlay
    setIsAnimating(false);
    setTimeout(() => {
      setShowSplash(false);
    }, 400);

    // Restore theme color
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', '#ffffff');
    }
  };

  return (
    <SplashContext.Provider value={{ splashComplete: true }}>
      {/* ALWAYS render children immediately - never block */}
      {children}

      {/* Lightweight CSS Splash Overlay - only shown on first session */}
      {showSplash && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: '#fbfcfc',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            opacity: isAnimating ? 1 : 0,
            transition: 'opacity 0.4s ease-out',
            overflow: 'hidden',
            pointerEvents: isAnimating ? 'auto' : 'none',
          }}
        >
          {/* Logo with CSS animation */}
          <img
            src="/icons/icon-192x192.png"
            alt="Talio"
            style={{
              width: 100,
              height: 100,
              borderRadius: 20,
              animation: 'splashLogoIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          />

          {/* Keyframe animations injected via style tag */}
          <style>{`
            @keyframes splashLogoIn {
              0% { opacity: 0; transform: scale(0.5); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}
    </SplashContext.Provider>
  );
}
