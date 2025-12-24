'use client';

import { useState, useEffect, useRef, createContext, useContext, lazy, Suspense } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import Lottie to reduce initial bundle size
const Lottie = dynamic(() => import('lottie-react'), { 
  ssr: false,
  loading: () => null 
});

const ANIMATION_URL = '/splash-animation.json';

// Context to track splash completion for blocking content
const SplashContext = createContext({ splashComplete: false });

export const useSplashComplete = () => useContext(SplashContext);

/**
 * SplashVideo Component
 * Plays a full-screen Lottie splash animation on first session start
 * - Desktop: Animation width reduced by 20%, centered
 * - Mobile: Full width, centered
 * - Background: #fbfcfc
 * - Auto-hides after animation ends
 * - Highest z-index to overlay all content
 * - BLOCKS all content rendering until splash is complete
 */
export default function SplashVideo({ children }) {
  const [showSplash, setShowSplash] = useState(null); // null = not yet determined
  const [animationData, setAnimationData] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [splashComplete, setSplashComplete] = useState(false);
  const lottieRef = useRef(null);

  useEffect(() => {
    // Check if this is the first session start
    const hasSeenSplash = sessionStorage.getItem('talio_splash_shown');
    
    if (hasSeenSplash) {
      // Already seen splash this session, don't show
      setShowSplash(false);
      setSplashComplete(true);
    } else {
      // Show splash and load animation
      setShowSplash(true);
      // Set theme color for mobile
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', '#fbfcfc');
      }
      
      // Load animation data
      loadAnimation();
    }
  }, []);

  const loadAnimation = async () => {
    try {
      const response = await fetch(ANIMATION_URL);
      const data = await response.json();
      setAnimationData(data);
      setIsAnimating(true);
      
      // Set 2x speed after animation loads
      setTimeout(() => {
        if (lottieRef.current) {
          lottieRef.current.setSpeed(2);
        }
      }, 50);
    } catch (error) {
      console.log('[SplashVideo] Error loading animation:', error.message);
      // On error, skip splash
      handleAnimationEnd();
    }
  };

  const handleAnimationEnd = () => {
    // Mark splash as shown for this session
    sessionStorage.setItem('talio_splash_shown', 'true');
    
    // Fade out and hide
    setShowSplash(false);
    setIsAnimating(false);
    
    // Mark splash as complete - this allows content to render
    setTimeout(() => {
      setSplashComplete(true);
    }, 300); // Wait for fade animation
    
    // Restore theme color
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', '#ffffff');
    }
  };

  // Show loading screen while determining if splash should show
  if (showSplash === null) {
    return (
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
        }}
      >
        {/* Empty loading state with same background */}
      </div>
    );
  }

  // If already determined not to show splash, just render children
  if (showSplash === false && splashComplete) {
    return (
      <SplashContext.Provider value={{ splashComplete }}>
        {children}
      </SplashContext.Provider>
    );
  }

  // Show splash animation
  return (
    <SplashContext.Provider value={{ splashComplete }}>
      {/* Splash Screen Overlay */}
      {showSplash && (
        <div 
          className="splash-video-container"
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
          }}
        >
          {animationData && (
            <div 
              className="splash-animation-wrapper"
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
                onDOMLoaded={() => {
                  if (lottieRef.current) {
                    lottieRef.current.setSpeed(1.5);
                  }
                }}
                onComplete={handleAnimationEnd}
                style={{
                  width: '100%',
                  height: '100%',
                }}
                className="splash-animation"
                rendererSettings={{
                  preserveAspectRatio: 'xMidYMax slice'
                }}
              />
            </div>
          )}

          {/* Responsive styles */}
          <style jsx global>{`
            .splash-animation-wrapper {
              height: 100vh !important;
              aspect-ratio: 9 / 16 !important;
              max-width: 100vw !important;
            }
            
            @media (max-width: 768px) {
              .splash-animation-wrapper {
                height: 100vh !important;
                height: 100dvh !important;
                width: 100vw !important;
                max-width: 100vw !important;
                aspect-ratio: unset !important;
              }
              
              .splash-animation-wrapper svg {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
              }
            }
          `}</style>
        </div>
      )}
      
      {/* Only render children when splash is complete */}
      {splashComplete && children}
    </SplashContext.Provider>
  );
}
