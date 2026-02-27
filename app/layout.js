import { Inter, Montserrat } from 'next/font/google'
import './globals.css'
import '../styles/mobile-responsive.css'
import '../styles/mobile-fix.css'
import '../styles/card-redesign.css'
import '../styles/theme.css'
import '../styles/ui-components.css'
import '../styles/dark-mode.css'
import { Toaster } from 'react-hot-toast'
import { Providers } from '@/components/Providers'
import ErrorPageCache from '@/components/ErrorPageCache'
import SplashVideo from '@/components/SplashVideo'

// Primary font - Montserrat
const montserrat = Montserrat({ 
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
  preload: false,
  adjustFontFallback: true,
})

// Secondary font - Inter
const inter = Inter({ 
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: false,
  adjustFontFallback: true,
})

// Note: Whiteboard fonts (Caveat, Dancing Script, etc.) are loaded dynamically
// when the whiteboard feature is used to avoid blocking initial page render

export const metadata = {
  title: 'Talio - Workforce Management Platform',
  description: 'Complete solution for managing employees, attendance, productivity, and more',
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon-32.png',
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
        {/* Dark mode flash prevention - applies dark class before paint */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var pref = localStorage.getItem('app-dark-mode-pref') || 'auto';
                var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (dark) document.documentElement.classList.add('dark');
              } catch(e) {}
            })();
          `
        }} />
        
        {/* DNS Prefetch for faster external resource loading */}
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
        
        {/* Preconnect to critical origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        
        {/* Material Icons - Load with low priority */}
        <link 
          href="https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined|Material+Icons+Round" 
          rel="stylesheet" 
          fetchPriority="low"
        />
        
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
        
        {/* URL Tracker - Saves last URL for offline recovery */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var STORAGE_KEY = 'talio_last_url';
              function saveUrl() {
                try {
                  var url = window.location.href;
                  if (url && !url.includes('/offline') && !url.startsWith('data:') && url.includes('talio')) {
                    localStorage.setItem(STORAGE_KEY, url);
                  }
                } catch(e) {}
              }
              // Save on page load
              saveUrl();
              // Save on navigation (SPA)
              var origPush = history.pushState;
              history.pushState = function() {
                origPush.apply(this, arguments);
                saveUrl();
              };
              var origReplace = history.replaceState;
              history.replaceState = function() {
                origReplace.apply(this, arguments);
                saveUrl();
              };
              window.addEventListener('popstate', saveUrl);
            })();
          `
        }} />
      </head>

      <body className={`${montserrat.className} ${montserrat.variable} ${inter.variable}`} suppressHydrationWarning>
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

