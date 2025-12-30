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
    <div className="mobile-layout">
      {/* Sidebar */}
      <MobileSidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)}
        user={user}
      />

      {/* Header */}
      {showHeader && (
        <header className="mobile-header">
          <button 
            onClick={() => setIsSidebarOpen(true)} 
            className="mobile-header-btn"
          >
            <span className="material-icons-round" style={{ fontSize: '24px', color: 'var(--mobile-gray-500)' }}>
              grid_view
            </span>
          </button>
          
          <h1 className="mobile-header-title">{getPageTitle()}</h1>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="mobile-header-btn">
              <span className="material-icons-round" style={{ fontSize: '24px', color: 'var(--mobile-gray-500)' }}>
                search
              </span>
            </button>
            <div 
              onClick={() => router.push('/dashboard/profile')}
              className="mobile-header-avatar"
            >
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name || 'User'} />
              ) : (
                getUserInitials()
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="mobile-main">
        {children}
      </main>
    </div>
  );
}
