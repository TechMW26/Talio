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
    { id: 'profile', path: '/dashboard/profile', icon: 'person', label: 'My Profile' },
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

  const isActive = (path) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(path);
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 10000,
          }}
          onClick={onClose}
        />
      )}

      {/* Sidebar Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '85%',
          maxWidth: '320px',
          backgroundColor: 'white',
          zIndex: 10001,
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s ease',
          boxShadow: isOpen ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)' : 'none',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px',
            borderBottom: '1px solid #f3f4f6',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                background: 'linear-gradient(135deg, #14B8A6, #0D9488)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="material-icons-round" style={{ fontSize: '20px', color: 'white' }}>
                hexagon
              </span>
            </div>
            <span style={{ fontSize: '22px', fontWeight: '800', color: '#0D9488', letterSpacing: '-0.025em' }}>
              Talio
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px',
              borderRadius: '50%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#9CA3AF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-icons-outlined" style={{ fontSize: '24px' }}>close</span>
          </button>
        </div>

        {/* Navigation - Scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            minHeight: 0,
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.path)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                borderRadius: '12px',
                background: isActive(item.path) ? '#EFF6FF' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                marginBottom: '4px',
                transition: 'background-color 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: isActive(item.path) ? '#3B82F6' : '#EFF6FF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    className="material-icons-outlined"
                    style={{
                      fontSize: '20px',
                      color: isActive(item.path) ? 'white' : '#3B82F6'
                    }}
                  >
                    {item.icon}
                  </span>
                </div>
                <span
                  style={{
                    fontWeight: isActive(item.path) ? '600' : '500',
                    color: isActive(item.path) ? '#1F2937' : '#4B5563',
                    fontSize: '15px',
                  }}
                >
                  {item.label}
                </span>
              </div>
              {item.hasSub && (
                <span className="material-icons-outlined" style={{ color: '#D1D5DB', fontSize: '18px' }}>
                  chevron_right
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid #f3f4f6',
            background: '#F9FAFB',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <button
              onClick={() => handleNavigate('/dashboard/chat')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '12px 8px',
                background: 'white',
                borderRadius: '14px',
                border: '1px solid #E5E7EB',
                cursor: 'pointer',
              }}
            >
              <span className="material-icons-outlined" style={{ color: '#3B82F6', fontSize: '22px' }}>chat</span>
              <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF' }}>
                Chat
              </span>
            </button>
            <button
              onClick={() => handleNavigate('/dashboard/settings')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '12px 8px',
                background: 'white',
                borderRadius: '14px',
                border: '1px solid #E5E7EB',
                cursor: 'pointer',
              }}
            >
              <span className="material-icons-outlined" style={{ color: '#3B82F6', fontSize: '22px' }}>settings</span>
              <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF' }}>
                Settings
              </span>
            </button>
            <button
              onClick={handleLogout}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '12px 8px',
                background: 'white',
                borderRadius: '14px',
                border: '1px solid #E5E7EB',
                cursor: 'pointer',
              }}
            >
              <span className="material-icons-outlined" style={{ color: '#EF4444', fontSize: '22px' }}>logout</span>
              <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF' }}>
                Logout
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
