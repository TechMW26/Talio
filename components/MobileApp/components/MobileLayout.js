'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MobileSidebar from './MobileSidebar';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Layout Component
 * Provides header and main content wrapper for mobile views
 * Note: Uses existing BottomNav from parent layout
 */
export default function MobileLayout({ children, title, user, showHeader = true }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Get page title from pathname if not provided
  const getPageTitle = () => {
    if (title) return title;

    const pathParts = pathname.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];

    if (lastPart === 'dashboard') return 'Home';
    return lastPart?.replace(/-/g, ' ') || 'Home';
  };

  // Get user initials for avatar
  const getUserInitials = () => {
    if (!user) return 'U';
    const name = user.name || user.email || '';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: '#F8FAFC',
        overflow: 'hidden',
      }}
    >
      {/* Sidebar */}
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        user={user}
      />

      {/* Header */}
      {showHeader && (
        <header
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            position: 'sticky',
            top: 0,
            zIndex: 30,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setIsSidebarOpen(true)}
            style={{
              padding: '8px',
              margin: '-8px',
              borderRadius: '50%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-icons-round" style={{ fontSize: '24px', color: '#6B7280' }}>
              grid_view
            </span>
          </button>

          <h1
            style={{
              fontSize: '18px',
              fontWeight: '700',
              textTransform: 'capitalize',
              color: '#111827',
              margin: 0,
            }}
          >
            {getPageTitle()}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              style={{
                padding: '8px',
                margin: '-8px',
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="material-icons-round" style={{ fontSize: '24px', color: '#6B7280' }}>
                search
              </span>
            </button>
            <div
              onClick={() => router.push('/dashboard/profile')}
              style={{
                height: '36px',
                width: '36px',
                background: '#3B82F6',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: '600',
                fontSize: '14px',
                boxShadow: '0 4px 6px rgba(59, 130, 246, 0.3)',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name || 'User'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                getUserInitials()
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: '100px',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </main>
    </div>
  );
}
