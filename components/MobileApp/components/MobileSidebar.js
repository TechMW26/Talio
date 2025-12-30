'use client';

import { usePathname, useRouter } from 'next/navigation';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Sidebar Component
 * Sliding navigation panel for mobile views
 */
export default function MobileSidebar({ isOpen, onClose, user }) {
  const router = useRouter();
  const pathname = usePathname();

  const menuItems = [
    { id: 'dashboard', path: '/dashboard', icon: 'grid_view', label: 'Dashboard' },
    { id: 'productivity', path: '/dashboard/productivity', icon: 'monitor', label: 'Productivity' },
    { id: 'chat', path: '/dashboard/chat', icon: 'chat_bubble_outline', label: 'Chat' },
    { id: 'mail', path: '/dashboard/mail', icon: 'mail_outline', label: 'Mail' },
    { id: 'meetings', path: '/dashboard/meetings', icon: 'videocam', label: 'Meetings' },
    { id: 'talioboard', path: '/dashboard/talioboard', icon: 'dashboard_customize', label: 'TalioBoard' },
    { id: 'projects', path: '/dashboard/projects', icon: 'assignment_turned_in', label: 'Projects', hasSub: true },
    { id: 'attendance', path: '/dashboard/attendance', icon: 'schedule', label: 'Attendance & Leaves', hasSub: true },
    { id: 'payroll', path: '/dashboard/payroll', icon: 'receipt_long', label: 'Payslips' },
    { id: 'documents', path: '/dashboard/documents', icon: 'folder_open', label: 'Documents' },
    { id: 'helpdesk', path: '/dashboard/helpdesk', icon: 'support_agent', label: 'Helpdesk' },
    { id: 'learning', path: '/dashboard/learning', icon: 'school', label: 'Learning' },
  ];

  const handleNavigate = (path) => {
    router.push(path);
    onClose();
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
    router.push('/login');
  };

  return (
    <>
      {/* Overlay */}
      <div 
        className={`mobile-sidebar-overlay ${isOpen ? '' : 'hidden'}`}
        onClick={onClose}
      />
      
      {/* Sidebar Panel */}
      <div className={`mobile-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <header className="mobile-sidebar-header">
          <div className="mobile-sidebar-logo">
            <div className="mobile-sidebar-logo-icon">
              <span className="material-icons-round" style={{ fontSize: '18px' }}>hexagon</span>
            </div>
            <span className="mobile-sidebar-logo-text">Talio</span>
          </div>
          <button onClick={onClose} className="mobile-sidebar-close">
            <span className="material-icons-outlined">close</span>
          </button>
        </header>

        {/* Navigation */}
        <nav className="mobile-sidebar-nav mobile-no-scrollbar">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.path)}
              className="mobile-sidebar-item"
            >
              <div className="mobile-sidebar-item-left">
                <div className="mobile-sidebar-item-icon">
                  <span className="material-icons-outlined" style={{ fontSize: '20px' }}>{item.icon}</span>
                </div>
                <span className="mobile-sidebar-item-label">{item.label}</span>
              </div>
              {item.hasSub && (
                <span className="material-icons-outlined" style={{ color: 'var(--mobile-gray-300)', fontSize: '14px' }}>
                  chevron_right
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <footer className="mobile-sidebar-footer">
          <div className="mobile-sidebar-footer-grid">
            <button 
              className="mobile-sidebar-footer-btn"
              onClick={() => handleNavigate('/dashboard/chat')}
            >
              <span className="material-icons-outlined">chat</span>
              <span className="mobile-sidebar-footer-btn-label">Chat</span>
            </button>
            <button 
              className="mobile-sidebar-footer-btn"
              onClick={() => handleNavigate('/dashboard/settings')}
            >
              <span className="material-icons-outlined">settings</span>
              <span className="mobile-sidebar-footer-btn-label">Settings</span>
            </button>
            <button 
              className="mobile-sidebar-footer-btn logout"
              onClick={handleLogout}
            >
              <span className="material-icons-outlined">logout</span>
              <span className="mobile-sidebar-footer-btn-label">Logout</span>
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}
