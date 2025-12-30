'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import { useTheme } from '@/contexts/ThemeContext';
import toast from '@/utils/toast';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Settings Page
 * Settings interface optimized for mobile devices
 * Includes: Personalization (all users), Notifications (admins/heads)
 */
export default function MobileSettings({ user }) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState('personalization');
    const [userRole, setUserRole] = useState('');
    const [isDepartmentHead, setIsDepartmentHead] = useState(false);
    const [loading, setLoading] = useState(true);

    // Theme context
    const { currentTheme, changeTheme, themes } = useTheme();

    // Notification settings state
    const [notificationSettings, setNotificationSettings] = useState({
        emailNotifications: true,
        pushNotifications: true,
        chatNotifications: true,
        leaveNotifications: true,
        attendanceNotifications: true,
        projectNotifications: true,
        announcementNotifications: true
    });
    const [savingNotifications, setSavingNotifications] = useState(false);

    useEffect(() => {
        const userData = localStorage.getItem('user');
        if (userData) {
            const parsedUser = JSON.parse(userData);
            setUserRole(parsedUser.role || '');
        }
        checkDepartmentHead();
        fetchNotificationPreferences();
        setLoading(false);
    }, []);

    // Check if user is a department head
    const checkDepartmentHead = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await fetch('/api/team/check-head', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (data.success && data.isDepartmentHead) {
                setIsDepartmentHead(true);
            }
        } catch (error) {
            console.error('Error checking department head:', error);
        }
    };

    // Fetch user notification preferences
    const fetchNotificationPreferences = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await fetch('/api/users/preferences', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (data.success && data.preferences?.notifications) {
                setNotificationSettings(prev => ({
                    ...prev,
                    ...data.preferences.notifications
                }));
            }
        } catch (error) {
            console.error('Error fetching notification preferences:', error);
        }
    };

    // Save notification preferences
    const saveNotificationPreferences = async () => {
        setSavingNotifications(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/users/preferences', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    notifications: notificationSettings
                })
            });

            const data = await response.json();
            if (data.success) {
                toast.success('Notification preferences saved!');
            } else {
                toast.error(data.message || 'Failed to save preferences');
            }
        } catch (error) {
            console.error('Error saving preferences:', error);
            toast.error('Failed to save preferences');
        } finally {
            setSavingNotifications(false);
        }
    };

    // Get available tabs based on role
    const getTabs = () => {
        const tabs = [
            { id: 'personalization', label: 'Theme', icon: 'palette' }
        ];

        // All users get notification preferences
        tabs.push({ id: 'notifications', label: 'Notifications', icon: 'notifications' });

        // Admin/HR get more settings
        if (userRole === 'admin' || userRole === 'hr') {
            tabs.push({ id: 'admin', label: 'Admin', icon: 'admin_panel_settings' });
        }

        return tabs;
    };

    const tabs = getTabs();

    // Theme colors for preview
    const themeColors = {
        default: { primary: '#3B82F6', secondary: '#2563EB', bg: '#EFF6FF' },
        purple: { primary: '#A855F7', secondary: '#9333EA', bg: '#FAF5FF' },
        green: { primary: '#22C55E', secondary: '#16A34A', bg: '#F0FDF4' },
        orange: { primary: '#F97316', secondary: '#EA580C', bg: '#FFF7ED' },
        teal: { primary: '#14B8A6', secondary: '#0D9488', bg: '#F0FDFA' }
    };

    // Handle theme change
    const handleThemeChange = (themeKey) => {
        changeTheme(themeKey);
        toast.success(`Theme changed to ${themes[themeKey]?.name || themeKey}!`, {
            icon: '🎨',
            duration: 2000
        });
    };

    // Render personalization tab
    const renderPersonalization = () => (
        <div className="mobile-settings-content">
            <div className="mobile-settings-section">
                <h3 className="mobile-settings-section-title">
                    <span className="material-icons">palette</span>
                    Choose Your Theme
                </h3>
                <p className="mobile-settings-section-desc">
                    Select a color theme that suits your preference
                </p>

                <div className="mobile-theme-grid">
                    {Object.keys(themes).map((themeKey) => {
                        const theme = themes[themeKey];
                        const colors = themeColors[themeKey] || themeColors.default;
                        const isActive = currentTheme === themeKey;

                        return (
                            <button
                                key={themeKey}
                                onClick={() => handleThemeChange(themeKey)}
                                className={`mobile-theme-card ${isActive ? 'active' : ''}`}
                                style={{
                                    borderColor: isActive ? colors.primary : '#E5E7EB',
                                    backgroundColor: isActive ? colors.bg : '#FFFFFF'
                                }}
                            >
                                {isActive && (
                                    <div
                                        className="mobile-theme-check"
                                        style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }}
                                    >
                                        <span className="material-icons">check</span>
                                    </div>
                                )}
                                <div
                                    className="mobile-theme-preview"
                                    style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }}
                                />
                                <span className="mobile-theme-name">{theme?.name || themeKey}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    // Render notifications tab
    const renderNotifications = () => (
        <div className="mobile-settings-content">
            <div className="mobile-settings-section">
                <h3 className="mobile-settings-section-title">
                    <span className="material-icons">notifications</span>
                    Notification Preferences
                </h3>
                <p className="mobile-settings-section-desc">
                    Choose which notifications you want to receive
                </p>

                <div className="mobile-notification-list">
                    <NotificationToggle
                        icon="email"
                        label="Email Notifications"
                        description="Receive important updates via email"
                        checked={notificationSettings.emailNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            emailNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="notifications_active"
                        label="Push Notifications"
                        description="Browser and app push notifications"
                        checked={notificationSettings.pushNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            pushNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="chat"
                        label="Chat Messages"
                        description="New messages and mentions"
                        checked={notificationSettings.chatNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            chatNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="event_available"
                        label="Leave Updates"
                        description="Leave requests and approvals"
                        checked={notificationSettings.leaveNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            leaveNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="schedule"
                        label="Attendance Alerts"
                        description="Check-in reminders and attendance"
                        checked={notificationSettings.attendanceNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            attendanceNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="folder"
                        label="Project Updates"
                        description="Task assignments and updates"
                        checked={notificationSettings.projectNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            projectNotifications: checked
                        }))}
                    />

                    <NotificationToggle
                        icon="campaign"
                        label="Announcements"
                        description="Company announcements"
                        checked={notificationSettings.announcementNotifications}
                        onChange={(checked) => setNotificationSettings(prev => ({
                            ...prev,
                            announcementNotifications: checked
                        }))}
                    />
                </div>

                <button
                    onClick={saveNotificationPreferences}
                    disabled={savingNotifications}
                    className="mobile-settings-save-btn"
                >
                    {savingNotifications ? (
                        <>
                            <span className="material-icons animate-spin">refresh</span>
                            Saving...
                        </>
                    ) : (
                        <>
                            <span className="material-icons">save</span>
                            Save Preferences
                        </>
                    )}
                </button>
            </div>
        </div>
    );

    // Render admin tab (redirects to full settings on web)
    const renderAdmin = () => (
        <div className="mobile-settings-content">
            <div className="mobile-settings-section">
                <h3 className="mobile-settings-section-title">
                    <span className="material-icons">admin_panel_settings</span>
                    Admin Settings
                </h3>
                <p className="mobile-settings-section-desc">
                    Advanced settings available on desktop
                </p>

                <div className="mobile-admin-links">
                    <AdminLink
                        icon="business"
                        label="Company Settings"
                        description="Company info, working hours, holidays"
                        onClick={() => toast.info('Please use desktop for company settings')}
                    />

                    <AdminLink
                        icon="location_on"
                        label="Geofencing"
                        description="Location-based attendance settings"
                        onClick={() => toast.info('Please use desktop for geofencing')}
                    />

                    <AdminLink
                        icon="payments"
                        label="Payroll Settings"
                        description="Salary components, deductions"
                        onClick={() => toast.info('Please use desktop for payroll settings')}
                    />

                    <AdminLink
                        icon="email"
                        label="Email Templates"
                        description="Customize notification emails"
                        onClick={() => toast.info('Please use desktop for email templates')}
                    />
                </div>

                <div className="mobile-admin-note">
                    <span className="material-icons">info</span>
                    <p>
                        For full administrative control, please access settings from a desktop browser.
                    </p>
                </div>
            </div>
        </div>
    );

    if (loading) {
        return (
            <MobileLayout title="Settings" user={user}>
                <div className="mobile-loading">
                    <div className="mobile-loading-spinner"></div>
                    <span>Loading settings...</span>
                </div>
            </MobileLayout>
        );
    }

    return (
        <MobileLayout title="Settings" user={user}>
            <div className="mobile-settings-container">
                {/* Tab Navigation */}
                <div className="mobile-settings-tabs">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`mobile-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                        >
                            <span className="material-icons">{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'personalization' && renderPersonalization()}
                {activeTab === 'notifications' && renderNotifications()}
                {activeTab === 'admin' && renderAdmin()}
            </div>
        </MobileLayout>
    );
}

// Notification Toggle Component
function NotificationToggle({ icon, label, description, checked, onChange }) {
    return (
        <div className="mobile-notification-item">
            <div className="mobile-notification-icon">
                <span className="material-icons">{icon}</span>
            </div>
            <div className="mobile-notification-info">
                <span className="mobile-notification-label">{label}</span>
                <span className="mobile-notification-desc">{description}</span>
            </div>
            <label className="mobile-toggle">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                />
                <span className="mobile-toggle-slider"></span>
            </label>
        </div>
    );
}

// Admin Link Component
function AdminLink({ icon, label, description, onClick }) {
    return (
        <button className="mobile-admin-link" onClick={onClick}>
            <div className="mobile-admin-link-icon">
                <span className="material-icons">{icon}</span>
            </div>
            <div className="mobile-admin-link-info">
                <span className="mobile-admin-link-label">{label}</span>
                <span className="mobile-admin-link-desc">{description}</span>
            </div>
            <span className="material-icons mobile-admin-link-arrow">chevron_right</span>
        </button>
    );
}
