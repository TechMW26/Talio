import { Raleway, Poppins, Caveat, Dancing_Script, Indie_Flower, Patrick_Hand, Shadows_Into_Light } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import '../styles/mobile-responsive.css'
import '../styles/mobile-fix.css'
import '../styles/card-redesign.css'
import '../styles/theme.css'
import '../styles/ui-components.css'
import { Toaster } from 'react-hot-toast'
import { Providers } from '@/components/Providers'
import ErrorPageCache from '@/components/ErrorPageCache'
import SplashVideo from '@/components/SplashVideo'

// Primary font - preload for faster rendering
const raleway = Raleway({ 
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-raleway',
  display: 'swap',
  preload: true,
})

// Secondary fonts - lazy load with display swap
const poppins = Poppins({ 
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-poppins',
  display: 'swap',
  preload: false,
})

// Whiteboard handwriting fonts - lazy load (not critical)
const caveat = Caveat({ 
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
  preload: false,
})
const dancingScript = Dancing_Script({ 
  subsets: ['latin'],
  variable: '--font-dancing-script',
  display: 'swap',
  preload: false,
})
const indieFlower = Indie_Flower({ 
  weight: '400',
  subsets: ['latin'],
  variable: '--font-indie-flower',
  display: 'swap',
  preload: false,
})
const patrickHand = Patrick_Hand({ 
  weight: '400',
  subsets: ['latin'],
  variable: '--font-patrick-hand',
  display: 'swap',
  preload: false,
})
const shadowsIntoLight = Shadows_Into_Light({ 
  weight: '400',
  subsets: ['latin'],
  variable: '--font-shadows-into-light',
  display: 'swap',
  preload: false,
})

export const metadata = {
  title: 'Talio - Workforce Management Platform',
  description: 'Complete solution for managing employees, attendance, productivity, and more',
  manifest: '/manifest.json',

  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Talio',
  },
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.png', sizes: '512x512', type: 'image/png' },
      { url: '/assets/lanyard-card-logo.webp', sizes: '512x512', type: 'image/webp' },
      { url: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
      { url: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon-32.png',
    apple: [
      { url: '/favicon.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'apple-mobile-web-app-title': 'Talio',
    'application-name': 'Talio',
    'msapplication-TileColor': '#ffffff',
    'msapplication-TileImage': '/icons/icon-144x144.png',
  },
}
export const viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}


export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* DNS Prefetch for faster external resource loading */}
        <link rel="dns-prefetch" href="https://cdn.socket.io" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
        
        {/* Preconnect to critical origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        
        {/* Preload splash animation for immediate loading */}
        <link rel="preload" href="/splash-animation.json" as="fetch" type="application/json" crossOrigin="anonymous" />
        
        {/* FCM Handler - For Android App Token Registration */}
        <script src="/fcm-handler.js" defer></script>
        
        {/* Patch for Next.js dev overlay removeChild error */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (typeof Node !== 'undefined') {
              const originalRemoveChild = Node.prototype.removeChild;
              Node.prototype.removeChild = function(child) {
                if (child.parentNode !== this) {
                  if (console) console.warn('removeChild: node is not a child', child);
                  return child;
                }
                return originalRemoveChild.apply(this, arguments);
              };
            }
          `
        }} />
      </head>

      <body className={`${raleway.className} ${raleway.variable} ${poppins.variable} ${caveat.variable} ${dancingScript.variable} ${indieFlower.variable} ${patrickHand.variable} ${shadowsIntoLight.variable}`} suppressHydrationWarning>
        {/* Socket.IO Client - Load after interactive for faster initial paint */}
        <Script 
          src="https://cdn.socket.io/4.8.1/socket.io.min.js" 
          integrity="sha384-mkQ3/7FUtcGyoppY6bz/PORYoGqOl7/aSUMn2ymDOJcapfS6PHqxhRTMh1RR0Q6+" 
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        
        {/* PWA Window Controls Overlay - Draggable title bar region */}
        <div className="pwa-titlebar-drag" aria-hidden="true" />
        <Providers>
          <SplashVideo>
            <ErrorPageCache />
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  fontSize: '14px',
                },
              }}
            />
          </SplashVideo>
        </Providers>
      </body>
    </html>
  )
}

