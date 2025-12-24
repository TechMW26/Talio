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
 * Plays a full-screen Lottie splash animation on first session start
 * NON-BLOCKING: Children always render immediately, splash is just an overlay on top
 */
export default function SplashVideo({ children }) {
  const [showSplash, setShowSplash] = useState(false);
  const [animationData, setAnimationData] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [Lottie, setLottie] = useState(null);
  const lottieRef = useRef(null);
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (initRef.current) return;
    initRef.current = true;

    // Skip splash entirely for desktop app - prevents potential blocking issues
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
        
        // Set theme color for mobile
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
          metaTheme.setAttribute('content', '#fbfcfc');
        }
        
        // Load Lottie and animation data
        loadSplash();
      }
    } catch (e) {
      // sessionStorage might not be available (private browsing, etc.)
      console.warn('[SplashVideo] sessionStorage not available:', e);
    }
  }, []);

  const loadSplash = async () => {
    try {
      // Dynamically import Lottie only when needed
      const lottieModule = await import('lottie-react');
      setLottie(() => lottieModule.default);

      // Fetch animation data
      const response = await fetch('/splash-animation.json');
      if (!response.ok) throw new Error('Failed to fetch animation');
      
      const data = await response.json();
      setAnimationData(data);
      setIsAnimating(true);
      
      // Set speed after animation loads
      setTimeout(() => {
        if (lottieRef.current) {
          lottieRef.current.setSpeed(1.5);
        }
      }, 50);
      
      // Fallback: auto-close after 5 seconds if animation doesn't complete
      setTimeout(() => {
        handleAnimationEnd();
      }, 5000);
    } catch (error) {
      console.warn('[SplashVideo] Error loading animation:', error.message);
      // On error, just hide splash
      handleAnimationEnd();
    }
  };

  const handleAnimationEnd = () => {
    try {
      // Mark splash as shown for this session
      sessionStorage.setItem('talio_splash_shown', 'true');
    } catch (e) {
      // Ignore sessionStorage errors
    }
    
    // Fade out and hide splash overlay
    setIsAnimating(false);
    setTimeout(() => {
      setShowSplash(false);
    }, 300);
    
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
      
      {/* Splash Screen Overlay - only shown on first session */}
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
            alignItems: 'flex-end',
            justifyContent: 'center',
            opacity: isAnimating ? 1 : 0,
            transition: 'opacity 0.3s ease-out',
            overflow: 'hidden',
            pointerEvents: isAnimating ? 'auto' : 'none',
          }}
        >
          {Lottie && animationData && (
            <div 
              style={{
                height: '100vh',
                aspectRatio: '9 / 16',
                maxWidth: '100vw',
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              <Lottie
                lottieRef={lottieRef}
                animationData={animationData}
                loop={false}
                autoplay={true}
                onComplete={handleAnimationEnd}
                style={{
                  width: '100%',
                  height: '100%',
                }}
                rendererSettings={{
                  preserveAspectRatio: 'xMidYMax slice'
                }}
              />
            </div>
          )}
        </div>
      )}
    </SplashContext.Provider>
  );
}
